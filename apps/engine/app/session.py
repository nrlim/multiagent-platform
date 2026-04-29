"""
AgentHive Engine - Session Manager (Phase 2)
Hierarchical agent nodes, message bus, and live session state.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import AsyncIterator, Literal


# ─── Agent Status ─────────────────────────────────────────────────────────────
AgentStatus = Literal["idle", "thinking", "working", "fixing", "completed", "error"]


@dataclass
class SessionLog:
    id: str
    session_id: str
    agent_id: str          # NEW: which agent produced this log
    timestamp: str
    level: str
    message: str
    metadata: dict = field(default_factory=dict)


@dataclass
class AgentNode:
    """
    Represents a single agent (Manager or Worker) within a Hive session.
    Maintains its own status, local context, and child references.
    """
    id: str
    role: str                          # e.g. "manager", "backend_dev", "frontend_dev"
    session_id: str
    parent_id: str | None = None
    status: AgentStatus = "idle"
    specialized_task: str = ""
    local_context: dict = field(default_factory=dict)
    children: list[str] = field(default_factory=list)   # child agent IDs
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "role": self.role,
            "session_id": self.session_id,
            "parent_id": self.parent_id,
            "status": self.status,
            "specialized_task": self.specialized_task,
            "local_context": self.local_context,
            "children": self.children,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
        }


# ─── Shared Message Bus ───────────────────────────────────────────────────────
class MessageBus:
    """
    In-memory pub/sub channel for inter-agent communication.
    Agents can publish artifacts (e.g. API docs, schemas) and subscribe to topics.
    """

    def __init__(self):
        self._store: dict[str, list[dict]] = {}           # topic -> messages
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    def publish(self, topic: str, payload: dict) -> None:
        if topic not in self._store:
            self._store[topic] = []
        self._store[topic].append(payload)
        for q in self._subscribers.get(topic, []):
            q.put_nowait(payload)

    def subscribe(self, topic: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(topic, []).append(q)
        return q

    def get_messages(self, topic: str) -> list[dict]:
        return self._store.get(topic, [])

    def get_all(self) -> dict[str, list[dict]]:
        return dict(self._store)


# ─── Hive Session ─────────────────────────────────────────────────────────────
@dataclass
class HiveSession:
    """
    Top-level container for a multi-agent Hive execution.
    Owns all AgentNodes, the MessageBus, and the shared log stream.
    """
    id: str
    provider: str
    model: str
    prompt: str
    status: str = "idle"       # idle | running | completed | failed
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: str | None = None

    # Agents registry
    agents: dict[str, AgentNode] = field(default_factory=dict)

    # Shared log stream (all agents funnel here)
    logs: list[SessionLog] = field(default_factory=list)
    _queue: asyncio.Queue = field(default_factory=asyncio.Queue, repr=False)
    _loop: asyncio.AbstractEventLoop | None = field(default=None, repr=False)

    # Inter-agent communication bus
    message_bus: MessageBus = field(default_factory=MessageBus, repr=False)

    def __post_init__(self):
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    def register_agent(self, agent: AgentNode) -> None:
        self.agents[agent.id] = agent
        if agent.parent_id and agent.parent_id in self.agents:
            parent = self.agents[agent.parent_id]
            if agent.id not in parent.children:
                parent.children.append(agent.id)

    def get_agent(self, agent_id: str) -> AgentNode | None:
        return self.agents.get(agent_id)

    def add_log(
        self,
        level: str,
        message: str,
        agent_id: str = "system",
        metadata: dict | None = None,
    ) -> SessionLog:
        entry = SessionLog(
            id=str(uuid.uuid4()),
            session_id=self.id,
            agent_id=agent_id,
            timestamp=datetime.utcnow().isoformat(),
            level=level,
            message=message,
            metadata=metadata or {},
        )
        self.logs.append(entry)
        if self._loop:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, entry)
        else:
            self._queue.put_nowait(entry)
        return entry

    async def stream_logs(self) -> AsyncIterator[SessionLog]:
        """Yield log entries as they arrive. Stops on sentinel None."""
        while True:
            entry = await self._queue.get()
            if entry is None:
                break
            yield entry

    def complete(self, success: bool = True) -> None:
        self.status = "completed" if success else "failed"
        self.completed_at = datetime.utcnow().isoformat()
        if self._loop:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)
        else:
            self._queue.put_nowait(None)

    def get_tree(self) -> list[dict]:
        """Return the agent tree as a list of node dicts (front-end friendly)."""
        return [node.to_dict() for node in self.agents.values()]


# ─── Legacy thin Session (backward compat) ───────────────────────────────────
@dataclass
class AgentSession:
    """Kept for Phase-1 /execute endpoint compatibility."""
    id: str
    provider: str
    model: str
    prompt: str
    status: str = "idle"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: str | None = None
    logs: list[SessionLog] = field(default_factory=list)
    _queue: asyncio.Queue = field(default_factory=asyncio.Queue, repr=False)
    _loop: asyncio.AbstractEventLoop | None = field(default=None, repr=False)

    def __post_init__(self):
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    def add_log(self, level: str, message: str, metadata: dict | None = None) -> SessionLog:
        entry = SessionLog(
            id=str(uuid.uuid4()),
            session_id=self.id,
            agent_id="root",
            timestamp=datetime.utcnow().isoformat(),
            level=level,
            message=message,
            metadata=metadata or {},
        )
        self.logs.append(entry)
        if self._loop:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, entry)
        else:
            self._queue.put_nowait(entry)
        return entry

    async def stream_logs(self) -> AsyncIterator[SessionLog]:
        while True:
            entry = await self._queue.get()
            if entry is None:
                break
            yield entry

    def complete(self, success: bool = True) -> None:
        self.status = "completed" if success else "failed"
        self.completed_at = datetime.utcnow().isoformat()
        if self._loop:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)
        else:
            self._queue.put_nowait(None)


# ─── Session Store ────────────────────────────────────────────────────────────
class SessionStore:
    def __init__(self):
        self._sessions: dict[str, AgentSession] = {}
        self._hive_sessions: dict[str, HiveSession] = {}

    # --- Legacy Phase-1 sessions ---
    def create(self, provider: str, model: str, prompt: str) -> AgentSession:
        session_id = str(uuid.uuid4())
        session = AgentSession(
            id=session_id,
            provider=provider,
            model=model,
            prompt=prompt,
            status="idle",
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> AgentSession | None:
        return self._sessions.get(session_id)

    def all(self) -> list[AgentSession]:
        return list(self._sessions.values())

    def delete(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    # --- Phase-2 Hive sessions ---
    def create_hive(
        self,
        provider: str,
        model: str,
        prompt: str,
        hive_id: str | None = None,
    ) -> HiveSession:
        sid = hive_id or str(uuid.uuid4())
        hive = HiveSession(
            id=sid,
            provider=provider,
            model=model,
            prompt=prompt,
            status="idle",
        )
        self._hive_sessions[sid] = hive
        return hive

    def get_hive(self, session_id: str) -> HiveSession | None:
        return self._hive_sessions.get(session_id)

    def all_hive(self) -> list[HiveSession]:
        return list(self._hive_sessions.values())


# Global singleton
session_store = SessionStore()
