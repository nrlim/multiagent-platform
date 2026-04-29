"""
AgentHive Swarm Engine - Core Primitives

Implements two primary primitives:
  - SwarmContext: stateless, fully self-contained task context passed between routines
  - Transfer: a hand-off object returned by a routine to redirect execution
  - SwarmRoutine: abstract base for all specialist routines
  - Swarm: orchestrates the run loop, enforces hop limits, emits HANDOFF events
  - run_swarm: convenience top-level coroutine

Design constraints:
  - Stateless: every Transfer carries the complete context the next routine needs
  - No shared mutable globals between routine executions
  - Max 12 hops per task to prevent infinite transfer loops
  - All hand-offs are logged as HANDOFF events visible in the dashboard
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.session import HiveSession, AgentNode

logger = logging.getLogger(__name__)

# Maximum number of agent-to-agent hops before the swarm self-terminates
_MAX_HOPS: int = 12


# ─── Swarm Context ────────────────────────────────────────────────────────────
@dataclass
class SwarmContext:
    """
    Immutable-by-convention context object passed between routines.
    Every hand-off must include a fully populated SwarmContext so the
    receiving routine can resume work immediately without external lookups.

    Fields
    ------
    hive_id             : Active HiveSession identifier (for event emission).
    task_id             : BucketTask identifier.
    task_title          : Human-readable task title.
    task_description    : Full task description from the bucket.
    history             : Ordered list of { role, content } message dicts.
    context_variables   : Shared key-value state (design specs, api specs, etc).
    artifact_bus        : Snapshot of message bus topics { topic: payload }.
    current_agent_role  : Role of the routine currently executing.
    handoff_chain       : Ordered list of roles that have processed this task.
    session_dir         : Filesystem path for workspace file I/O.
    budget_remaining    : Estimated USD budget remaining (checked before each LLM call).
    hive                : Reference to the live HiveSession (injected by Swarm).
    last_worker_role    : Most recent specialist role (used by Guardian for re-routing).
    """

    hive_id: str
    task_id: str
    task_title: str
    task_description: str
    history: list[dict] = field(default_factory=list)
    context_variables: dict = field(default_factory=dict)
    artifact_bus: dict = field(default_factory=dict)
    current_agent_role: str = "swarm_dispatcher"
    handoff_chain: list[str] = field(default_factory=list)
    session_dir: Path = field(default_factory=lambda: Path("."))
    budget_remaining: float = 2.0
    hive: object | None = None          # HiveSession — set by Swarm before calling routine
    last_worker_role: str = ""          # Tracks who the Guardian should re-route to
    token_usage: dict = field(default_factory=dict)  # {role: {"input": N, "output": N, "cost": N}}

    def append_history(self, role: str, content: str) -> "SwarmContext":
        """Return a new context with an additional history entry (non-mutating pattern)."""
        updated = SwarmContext(
            hive_id=self.hive_id,
            task_id=self.task_id,
            task_title=self.task_title,
            task_description=self.task_description,
            history=self.history + [{"role": role, "content": content}],
            context_variables=dict(self.context_variables),
            artifact_bus=dict(self.artifact_bus),
            current_agent_role=self.current_agent_role,
            handoff_chain=list(self.handoff_chain),
            session_dir=self.session_dir,
            budget_remaining=self.budget_remaining,
            hive=self.hive,
            last_worker_role=self.last_worker_role,
            token_usage=dict(self.token_usage),
        )
        return updated

    def with_role(self, role: str) -> "SwarmContext":
        """Return a new context with updated current_agent_role."""
        updated = SwarmContext(
            hive_id=self.hive_id,
            task_id=self.task_id,
            task_title=self.task_title,
            task_description=self.task_description,
            history=list(self.history),
            context_variables=dict(self.context_variables),
            artifact_bus=dict(self.artifact_bus),
            current_agent_role=role,
            handoff_chain=list(self.handoff_chain),
            session_dir=self.session_dir,
            budget_remaining=self.budget_remaining,
            hive=self.hive,
            last_worker_role=self.last_worker_role,
            token_usage=dict(self.token_usage),
        )
        return updated

    def with_variable(self, key: str, value: object) -> "SwarmContext":
        """Return a new context with an additional context variable."""
        new_vars = dict(self.context_variables)
        new_vars[key] = value
        updated = SwarmContext(
            hive_id=self.hive_id,
            task_id=self.task_id,
            task_title=self.task_title,
            task_description=self.task_description,
            history=list(self.history),
            context_variables=new_vars,
            artifact_bus=dict(self.artifact_bus),
            current_agent_role=self.current_agent_role,
            handoff_chain=list(self.handoff_chain),
            session_dir=self.session_dir,
            budget_remaining=self.budget_remaining,
            hive=self.hive,
            last_worker_role=self.last_worker_role,
            token_usage=dict(self.token_usage),
        )
        return updated

    def build_context_block(self) -> str:
        """Render a human-readable context string for injection into LLM prompts."""
        parts: list[str] = []

        if self.handoff_chain:
            parts.append(f"## Hand-off Chain\n{' -> '.join(self.handoff_chain)}")

        if self.artifact_bus:
            lines = [f"- [{topic}]: {str(payload)[:200]}" for topic, payload in self.artifact_bus.items()]
            parts.append("## Shared Artifacts\n" + "\n".join(lines))

        if self.context_variables:
            lines = [f"- {k}: {str(v)[:300]}" for k, v in self.context_variables.items()]
            parts.append("## Context Variables\n" + "\n".join(lines))

        if self.history:
            recent = self.history[-6:]
            lines = [f"[{m['role']}]: {m['content'][:300]}" for m in recent]
            parts.append("## Conversation History (recent)\n" + "\n".join(lines))

        return "\n\n".join(parts) if parts else ""


# ─── Transfer ────────────────────────────────────────────────────────────────
@dataclass
class Transfer:
    """
    Returned by a SwarmRoutine.run() to hand off to the next routine.
    Contains the full context so the receiving routine needs no external state.

    Fields
    ------
    target_routine : Role identifier of the next routine to execute.
    context        : Fully populated SwarmContext (including updated history).
    reason         : Human-readable explanation of why the hand-off occurred.
                     Shown in the dashboard feed as a HANDOFF event.
    """

    target_routine: str
    context: SwarmContext
    reason: str = ""


# ─── SwarmRoutine (Abstract Base) ────────────────────────────────────────────
class SwarmRoutine(ABC):
    """
    Abstract base for all Swarm Routines.

    Subclasses must implement:
      - role: str — unique role identifier
      - system_prompt: str — injected as system context for the LLM
      - available_transfers: list[str] — roles this routine is allowed to transfer to
      - async run(ctx: SwarmContext) -> Transfer | str
          Returns a Transfer to continue the swarm, or a str as the final answer.
    """

    role: str = "base"
    system_prompt: str = ""
    available_transfers: list[str] = []

    @abstractmethod
    async def run(self, ctx: SwarmContext) -> Transfer | str:
        """
        Execute this routine's logic and return either:
          - Transfer: to continue execution with another routine
          - str: the final answer / completion summary (self-terminates)
        """
        ...

    def _build_handoff_instructions(self) -> str:
        """Build the hand-off action block format appended to every routine prompt."""
        transfer_blocks = "\n".join(
            f'  - `transfer_to_{role.replace("_", "_")}`: Hand off to the {role.replace("_", " ").title()} routine'
            for role in self.available_transfers
        )
        return f"""
## Hand-off Protocol
When you have completed your specialized work, you MUST return one of these action blocks:

### Transfer (continue swarm):
```action
{{"action": "transfer_to_<role>", "reason": "<why you are handing off>"}}
```
Available transfers for your role:
{transfer_blocks}

### Terminate (task complete — only Guardian may call this):
```action
{{"action": "terminate_and_report", "final_output": "<complete summary of what was accomplished>"}}
```

CRITICAL: Your response MUST end with exactly one action block. Do not ask questions. Act autonomously.
""".strip()


# ─── Swarm Orchestrator ───────────────────────────────────────────────────────
class Swarm:
    """
    The Swarm orchestrator.

    Manages the active routine registry and drives the run loop:
      1. Start with entry_routine and initial SwarmContext.
      2. Call routine.run(ctx) — get back Transfer or str.
      3. If Transfer: emit HANDOFF event, update context, switch to target routine.
      4. If str (final answer): emit SWARM_DONE event, return.
      5. Enforce max hop limit to prevent infinite loops.

    The Swarm is stateless between tasks. Each run_swarm call is independent.
    """

    def __init__(self, routines: list[SwarmRoutine]) -> None:
        self._routines: dict[str, SwarmRoutine] = {r.role: r for r in routines}

    def register(self, routine: SwarmRoutine) -> None:
        """Register (or replace) a routine at runtime."""
        self._routines[routine.role] = routine

    async def run_swarm(
        self,
        entry_role: str,
        ctx: SwarmContext,
    ) -> str:
        """
        Execute the swarm loop starting from entry_role.

        Returns
        -------
        str : Final output produced by terminate_and_report.

        Raises
        ------
        ValueError : If entry_role is not registered.
        RuntimeError : If MAX_HOPS is exceeded (infinite loop guard).
        """
        from app.events import emit_event

        if entry_role not in self._routines:
            raise ValueError(f"[Swarm] Unknown entry routine: {entry_role!r}")

        current_role = entry_role
        hop = 0

        while hop < _MAX_HOPS:
            routine = self._routines.get(current_role)
            if routine is None:
                logger.error("[Swarm] Routine not found for role=%s — terminating", current_role)
                return f"[Swarm] Aborted: no routine registered for role={current_role}"

            # Update context with current execution role
            ctx = ctx.with_role(current_role)

            logger.info("[Swarm] hop=%d role=%s task=%s", hop, current_role, ctx.task_id[:8])

            result = await routine.run(ctx)
            hop += 1

            if isinstance(result, str):
                # Final answer — routine terminated the swarm
                emit_event(
                    "SWARM_DONE",  # type: ignore[arg-type]
                    hive_id=ctx.hive_id,
                    agent_id="system",
                    data={
                        "final_output": result[:400],
                        "hops": hop,
                        "task_id": ctx.task_id,
                        "handoff_chain": ctx.handoff_chain,
                    },
                )
                logger.info("[Swarm] Completed in %d hops: %s", hop, ctx.task_title[:60])
                return result

            if isinstance(result, Transfer):
                from_role = current_role
                to_role = result.target_routine

                # Validate target is a known routine
                if to_role not in self._routines:
                    logger.warning(
                        "[Swarm] Transfer to unknown routine %r — terminating", to_role
                    )
                    return f"[Swarm] Terminated: transfer to unknown routine {to_role!r}"

                # Update handoff chain on the context
                new_chain = list(result.context.handoff_chain) + [from_role]
                result.context.handoff_chain = new_chain
                result.context.last_worker_role = from_role

                # Emit HANDOFF event (visible in dashboard feed as horizontal pulse)
                emit_event(
                    "HANDOFF",  # type: ignore[arg-type]
                    hive_id=ctx.hive_id,
                    agent_id="system",
                    data={
                        "from_role": from_role,
                        "to_role": to_role,
                        "reason": result.reason,
                        "hop": hop,
                        "task_title": ctx.task_title,
                        "handoff_chain": new_chain,
                    },
                    role=from_role,
                )

                logger.info(
                    "[Swarm] HANDOFF hop=%d: %s -> %s | reason: %s",
                    hop, from_role, to_role, result.reason[:80],
                )

                ctx = result.context
                current_role = to_role
                await asyncio.sleep(0.1)  # yield to event loop between hops
                continue

            # Unexpected return type — abort safely
            logger.error("[Swarm] Unexpected return type from %s: %r", current_role, type(result))
            return f"[Swarm] Aborted: unexpected return type from routine {current_role}"

        # Max hops exceeded
        logger.error("[Swarm] MAX_HOPS (%d) exceeded for task=%s", _MAX_HOPS, ctx.task_id)
        emit_event(
            "ERROR",
            hive_id=ctx.hive_id,
            agent_id="system",
            data={
                "type": "SwarmMaxHopsExceeded",
                "hops": hop,
                "task_id": ctx.task_id,
                "handoff_chain": ctx.handoff_chain,
                "error": f"Swarm exceeded maximum {_MAX_HOPS} hops for task: {ctx.task_title}",
            },
        )
        return f"[Swarm] Aborted after {_MAX_HOPS} hops: {ctx.task_title}"


# ─── Top-level convenience function ──────────────────────────────────────────
async def run_swarm(
    routines: list[SwarmRoutine],
    entry_role: str,
    ctx: SwarmContext,
) -> str:
    """
    Convenience wrapper: build a Swarm from routines list and run it.

    Parameters
    ----------
    routines   : List of SwarmRoutine instances to register.
    entry_role : Role identifier of the first routine to execute.
    ctx        : Initial SwarmContext for the task.

    Returns
    -------
    str : Final output from terminate_and_report.
    """
    swarm = Swarm(routines)
    return await swarm.run_swarm(entry_role, ctx)
