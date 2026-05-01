"""
AgentHive Engine - Event Bus (Phase 3)
Typed event system with Redis pub/sub backbone.
Falls back gracefully to no-op if Redis is unavailable.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Literal

from app import config

# ─── Event Types ──────────────────────────────────────────────────────────────
EventType = Literal[
    "SPAWN",           # New agent spawned
    "PREPARING_SPAWN", # Pre-spawn shimmer hint (before LLM decides role)
    "STATUS",          # Agent status changed
    "THOUGHT",         # LLM reasoning / planning output
    "TOOL_CALL",       # Agent calling a tool (write_file, execute_command…)
    "SHELL_OUTPUT",    # Raw stdout/stderr line from a subprocess
    "ARTIFACT",        # Inter-agent artifact published to message bus
    "FILE_CHANGE",     # File created/updated in workspace
    "DONE",            # Agent or hive completed
    "ERROR",           # Agent error
    "LOG",             # Generic log line
    "CHAT",            # Humanized dialogue message (translated by dialogue layer)
    "BUCKET_UPDATE",   # Task bucket status change
    "FACTORY_START",   # Factory loop started
    "FACTORY_PROGRESS",# Factory progress tick
    "FACTORY_DONE",    # Factory loop finished
    # ── Swarm events ──────────────────────────────────────────────────────
    "HANDOFF",         # Agent-to-agent transfer in the swarm (from_role → to_role)
    "SWARM_DONE",      # Swarm task terminated via terminate_and_report
    # ── Parallel swarm events ─────────────────────────────────────────────
    "PARALLEL_START",  # Fan-out: multiple branches started concurrently
    "PARALLEL_MERGE",  # Fan-in: all parallel branches complete, merging results
]

REDIS_CHANNEL = "agenthive:events"


@dataclass
class HiveEvent:
    """
    Canonical event payload emitted by every agent action.
    All fields are JSON-serialisable.
    """
    event_type: EventType
    hive_id: str
    agent_id: str
    data: str | dict
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    parent_id: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


# ─── EventBus ─────────────────────────────────────────────────────────────────
class EventBus:
    """
    Central event router.
    - Publishes events to Redis (if available) for cross-process delivery.
    - Maintains in-memory subscribers for same-process SSE/WS delivery.
    - Stores full event history per hive_id for history replay.
    """

    def __init__(self):
        self._redis = None           # redis.asyncio.Redis instance (lazy)
        self._redis_ok = False
        self._history: dict[str, list[HiveEvent]] = {}   # hive_id → events
        self._subscribers: list[asyncio.Queue] = []       # live in-proc subscribers

    # ── Redis init (optional) ─────────────────────────────────────────────────
    async def connect_redis(self) -> bool:
        """Attempt to connect to Redis. Returns True if successful."""
        if not config.REDIS_URL:
            return False
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(config.REDIS_URL, decode_responses=True)
            await r.ping()
            self._redis = r
            self._redis_ok = True
            print(f"[EventBus] Redis connected: {config.REDIS_URL}")
            return True
        except Exception as e:
            print(f"[EventBus] Redis unavailable ({e}), using in-memory fallback.")
            self._redis_ok = False
            return False

    # ── Subscribe ─────────────────────────────────────────────────────────────
    def subscribe(self) -> asyncio.Queue:
        """Register a queue to receive all future events (for SSE/WS streaming)."""
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    # ── Publish ───────────────────────────────────────────────────────────────
    async def publish(self, event: HiveEvent) -> None:
        """Publish an event to all channels."""
        # 1. Store in history
        self._history.setdefault(event.hive_id, []).append(event)

        # 2. Push to in-process subscribers
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

        # 3. Publish to Redis (fire-and-forget)
        if self._redis_ok and self._redis:
            try:
                await self._redis.publish(REDIS_CHANNEL, event.to_json())
            except Exception:
                pass

    # ── History Replay ────────────────────────────────────────────────────────
    def get_history(self, hive_id: str) -> list[HiveEvent]:
        return self._history.get(hive_id, [])

    def get_all_history(self) -> dict[str, list[HiveEvent]]:
        return dict(self._history)


# ─── Global singleton ─────────────────────────────────────────────────────────
event_bus = EventBus()


# ─── Helper: fire-and-forget emit ─────────────────────────────────────────────
def emit_event(
    event_type: EventType,
    hive_id: str,
    agent_id: str,
    data: str | dict,
    parent_id: str | None = None,
    role: str = "",
    all_roles: list[str] | None = None,
) -> None:
    """
    Synchronous helper to schedule an event on the running event loop.
    Also emits a companion CHAT event via the dialogue translation layer
    for event_types that produce human-readable messages.
    Safe to call from sync or async contexts.
    """
    ev = HiveEvent(
        event_type=event_type,
        hive_id=hive_id,
        agent_id=agent_id,
        data=data,
        parent_id=parent_id,
    )
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(event_bus.publish(ev))
        # ── Dialogue translation (only for chat-worthy events) ────────────────
        _maybe_emit_chat(event_type, hive_id, agent_id, data, parent_id, role, all_roles, loop)
    except RuntimeError:
        # No running loop (sync context) — push directly to history only
        event_bus._history.setdefault(hive_id, []).append(ev)


_CHAT_EVENT_TYPES = {
    "SPAWN", "STATUS", "THOUGHT", "TOOL_CALL", "FILE_CHANGE",
    "ARTIFACT", "DONE", "ERROR",
    "HANDOFF", "SWARM_DONE",
}


def _maybe_emit_chat(
    event_type: str,
    hive_id: str,
    agent_id: str,
    data: str | dict,
    parent_id: str | None,
    role: str,
    all_roles: list[str] | None,
    loop: asyncio.AbstractEventLoop,
) -> None:
    if event_type not in _CHAT_EVENT_TYPES:
        return
    if not role:
        return
    try:
        from app.dialogue import translate_event_to_chat
        chat = translate_event_to_chat(
            event_type=event_type,
            role=role,
            data=data if isinstance(data, dict) else {},
            all_roles=all_roles,
        )
        if chat:
            chat_ev = HiveEvent(
                event_type="CHAT",  # type: ignore[arg-type]
                hive_id=hive_id,
                agent_id=agent_id,
                data=chat,
                parent_id=parent_id,
            )
            loop.create_task(event_bus.publish(chat_ev))
    except Exception:
        pass  # dialogue errors must never crash the engine
