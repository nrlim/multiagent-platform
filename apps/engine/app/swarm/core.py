"""
AgentHive Swarm Engine - Core Primitives

Implements parallel swarm primitives:
  - SwarmContext: stateless, fully self-contained task context passed between routines
  - Transfer: a hand-off object returned by a routine to redirect execution
  - ParallelBranch: a single branch in a parallel fan-out
  - ParallelTransfer: fan-out to N branches running concurrently via asyncio.gather
  - BranchResult: result from one completed parallel branch
  - SwarmRoutine: abstract base for all specialist routines
  - Swarm: orchestrates the run loop (sequential OR parallel), enforces hop limits
  - run_swarm: convenience top-level coroutine

Design constraints:
  - Stateless: every Transfer carries the complete context the next routine needs
  - No shared mutable globals between routine executions
  - Max 20 hops per task to prevent infinite transfer loops
  - Parallel branches run concurrently and fan-in to a merge_routine
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
# Set to 20 to allow: Dispatcher → UiUxScout → PixelCrafter → Guardian → [1 revision] → Guardian
_MAX_HOPS: int = 20


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
    # ── Parallel execution support ──────────────────────────────────────────
    branch_id: str = ""                                      # which parallel branch this ctx belongs to
    branch_results: list[dict] = field(default_factory=list) # aggregated results from child branches
    parallel_depth: int = 0                                  # nesting level of parallelism

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
    Returned by a SwarmRoutine.run() to hand off to the next routine (sequential).

    Fields
    ------
    target_routine : Role identifier of the next routine to execute.
    context        : Fully populated SwarmContext (including updated history).
    reason         : Human-readable explanation of why the hand-off occurred.
    """

    target_routine: str
    context: SwarmContext
    reason: str = ""


# ─── Parallel Execution Primitives ───────────────────────────────────────────
@dataclass
class ParallelBranch:
    """
    Represents a single autonomous branch in a parallel fan-out.
    Each branch runs its own sub-swarm chain independently.

    Fields
    ------
    branch_id      : Unique identifier for this branch.
    target_routine : Starting routine for this branch.
    context        : Fully populated SwarmContext for this branch.
    reason         : Why this branch was created.
    """

    branch_id: str
    target_routine: str
    context: SwarmContext
    reason: str = ""


@dataclass
class ParallelTransfer:
    """
    Returned by a SwarmRoutine to fan-out into N parallel branches.
    All branches run concurrently via asyncio.gather().
    Results are collected into BranchResult list and merged by merge_routine.

    Fields
    ------
    branches       : List of ParallelBranch to execute in parallel.
    merge_routine  : Role of the routine that aggregates all branch results.
    context        : Base context (will be enriched with branch_results).
    reason         : Why parallel execution was chosen.
    """

    branches: list[ParallelBranch]
    merge_routine: str
    context: SwarmContext
    reason: str = ""


@dataclass
class BranchResult:
    """
    Captures the outcome of a single parallel branch.

    Fields
    ------
    branch_id   : Matches the ParallelBranch.branch_id.
    role        : Final routine role that produced the output.
    output      : Final string output (or error message).
    success     : False if the branch raised an exception.
    context     : Final SwarmContext after the branch completed.
    """

    branch_id: str
    role: str
    output: str
    success: bool = True
    context: SwarmContext | None = None


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
    The Swarm orchestrator — supports both sequential and parallel execution.

    Sequential: routine returns Transfer → linear hand-off chain.
    Parallel:   routine returns ParallelTransfer → N branches run concurrently
                via asyncio.gather(), results merged into merge_routine.

    The Swarm is stateless between tasks. Each run_swarm call is independent.
    """

    def __init__(self, routines: list[SwarmRoutine]) -> None:
        self._routines: dict[str, SwarmRoutine] = {r.role: r for r in routines}

    def register(self, routine: SwarmRoutine) -> None:
        """Register (or replace) a routine at runtime."""
        self._routines[routine.role] = routine

    async def _run_branch(self, branch: "ParallelBranch") -> "BranchResult":
        """
        Run a single parallel branch as an independent sub-swarm.
        Each branch starts at branch.target_routine and runs to completion.
        """
        branch_ctx = branch.context.with_role(branch.target_routine)
        branch_ctx.branch_id = branch.branch_id

        logger.info(
            "[Swarm] branch=%s starting at role=%s task=%s",
            branch.branch_id[:8], branch.target_routine, branch_ctx.task_id[:8],
        )
        try:
            output = await self.run_swarm(
                entry_role=branch.target_routine,
                ctx=branch_ctx,
            )
            return BranchResult(
                branch_id=branch.branch_id,
                role=branch.target_routine,
                output=output,
                success=True,
                context=branch_ctx,
            )
        except Exception as exc:
            logger.error("[Swarm] branch=%s failed: %s", branch.branch_id[:8], exc)
            return BranchResult(
                branch_id=branch.branch_id,
                role=branch.target_routine,
                output=f"[branch error] {exc}",
                success=False,
                context=branch_ctx,
            )

    def _merge_branch_results(
        self,
        base_ctx: SwarmContext,
        results: list["BranchResult | BaseException"],
    ) -> SwarmContext:
        """
        Merge all branch results into a single SwarmContext.
        Accumulated artifacts and branch outputs are stored in context_variables.
        """
        merged_results: list[dict] = []
        merged_artifact_bus: dict = dict(base_ctx.artifact_bus)
        merged_vars: dict = dict(base_ctx.context_variables)
        merged_history: list[dict] = list(base_ctx.history)

        for r in results:
            if isinstance(r, BaseException):
                merged_results.append({"success": False, "output": str(r), "role": "unknown"})
                continue
            merged_results.append({
                "branch_id": r.branch_id,
                "role": r.role,
                "output": r.output[:500],
                "success": r.success,
            })
            # Merge artifact bus from each branch
            if r.context:
                for k, v in r.context.artifact_bus.items():
                    merged_artifact_bus[k] = v
                for k, v in r.context.context_variables.items():
                    if k not in ("branch_results", "prior_tasks"):
                        merged_vars[k] = v
                merged_history.extend(r.context.history[-3:])

        # Store aggregated branch results for the merge_routine
        merged_vars["branch_results"] = merged_results

        return SwarmContext(
            hive_id=base_ctx.hive_id,
            task_id=base_ctx.task_id,
            task_title=base_ctx.task_title,
            task_description=base_ctx.task_description,
            history=merged_history,
            context_variables=merged_vars,
            artifact_bus=merged_artifact_bus,
            current_agent_role=base_ctx.current_agent_role,
            handoff_chain=list(base_ctx.handoff_chain),
            session_dir=base_ctx.session_dir,
            budget_remaining=base_ctx.budget_remaining,
            hive=base_ctx.hive,
            last_worker_role=base_ctx.last_worker_role,
            token_usage=dict(base_ctx.token_usage),
            branch_results=merged_results,
            parallel_depth=base_ctx.parallel_depth,
        )

    async def run_swarm(
        self,
        entry_role: str,
        ctx: SwarmContext,
    ) -> str:
        """
        Execute the swarm loop starting from entry_role.
        Supports both sequential (Transfer) and parallel (ParallelTransfer) execution.

        Returns str — final output produced by terminate_and_report.
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

            ctx = ctx.with_role(current_role)
            logger.info("[Swarm] hop=%d role=%s task=%s", hop, current_role, ctx.task_id[:8])

            result = await routine.run(ctx)
            hop += 1

            # ── Final answer ────────────────────────────────────────────────
            if isinstance(result, str):
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

            # ── Sequential hand-off ─────────────────────────────────────────
            if isinstance(result, Transfer):
                from_role = current_role
                to_role = result.target_routine

                if to_role not in self._routines:
                    logger.warning("[Swarm] Transfer to unknown routine %r — terminating", to_role)
                    return f"[Swarm] Terminated: transfer to unknown routine {to_role!r}"

                new_chain = list(result.context.handoff_chain) + [from_role]
                result.context.handoff_chain = new_chain
                result.context.last_worker_role = from_role

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
                await asyncio.sleep(0.05)
                continue

            # ── Parallel fan-out ────────────────────────────────────────────
            if isinstance(result, ParallelTransfer):
                from_role = current_role
                n = len(result.branches)
                logger.info(
                    "[Swarm] PARALLEL_START hop=%d from=%s branches=%d merge_into=%s",
                    hop, from_role, n, result.merge_routine,
                )
                emit_event(
                    "PARALLEL_START",  # type: ignore[arg-type]
                    hive_id=ctx.hive_id,
                    agent_id="system",
                    data={
                        "from_role": from_role,
                        "branches": [b.target_routine for b in result.branches],
                        "merge_routine": result.merge_routine,
                        "reason": result.reason,
                        "hop": hop,
                    },
                    role=from_role,
                )

                # Run ALL branches concurrently — true parallel execution
                branch_tasks = [self._run_branch(branch) for branch in result.branches]
                raw_results = await asyncio.gather(*branch_tasks, return_exceptions=True)

                # Fan-in: merge all branch results into one context
                merged_ctx = self._merge_branch_results(result.context, list(raw_results))  # type: ignore
                new_chain = list(merged_ctx.handoff_chain) + [from_role]
                merged_ctx.handoff_chain = new_chain
                merged_ctx.last_worker_role = from_role

                success_count = sum(1 for r in raw_results if isinstance(r, BranchResult) and r.success)
                emit_event(
                    "PARALLEL_MERGE",  # type: ignore[arg-type]
                    hive_id=ctx.hive_id,
                    agent_id="system",
                    data={
                        "merge_routine": result.merge_routine,
                        "branches_total": n,
                        "branches_ok": success_count,
                        "hop": hop,
                    },
                    role=result.merge_routine,
                )
                logger.info(
                    "[Swarm] PARALLEL_MERGE: %d/%d branches succeeded → %s",
                    success_count, n, result.merge_routine,
                )

                ctx = merged_ctx
                current_role = result.merge_routine
                hop += n  # count branch hops toward limit
                await asyncio.sleep(0.05)
                continue

            # Unexpected return type
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
    """Convenience wrapper: build a Swarm from routines list and run it."""
    swarm = Swarm(routines)
    return await swarm.run_swarm(entry_role, ctx)
