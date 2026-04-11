"""
AgentHive Engine - Bucket Dispatcher (Phase 5)

The Dispatcher is the "Factory" that continuously drains the BucketQueue.
It creates a single HiveSession whose Manager Agent processes tasks sequentially,
with context stitching between tasks for code consistency.

Flow:
  1. User clicks "Start Factory" → POST /bucket/start
  2. Dispatcher creates HiveSession, spawns Manager
  3. Manager picks next PENDING task from queue
  4. Manager delegates to a Worker (matching role or fresh spawn)
  5. Worker completes → QA gate → mark COMPLETED → next task
  6. If Worker fails → auto-retry → auto debug task
  7. Factory stops when queue is empty or stop() is called
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable

from app import config
from app.agents.factory import create_agent
from app.agents.prompts import get_system_prompt
from app.bucket import bucket_queue, BucketTask
from app.db import db_upsert_hive, db_upsert_agent, db_update_task_status
from app.events import emit_event
from app.hive import (
    run_worker,
    run_qa_agent,
    EventedFileSystemTool,
    EventedTerminalTool,
    _extract_actions,
    _accumulate_chars,
    _is_killed,
    _hive_killed,
    _hive_char_counters,
    _COST_PER_1K,
    _DEFAULT_BUDGET_LIMIT,
)
from app.session import AgentNode, HiveSession, session_store

logger = logging.getLogger(__name__)

# ── Factory State ──────────────────────────────────────────────────────────────
# Tracks active factory run per hive_id
_running_factories: dict[str, asyncio.Task] = {}


# ── Dispatcher System Prompt ───────────────────────────────────────────────────
DISPATCHER_PROMPT = """
You are the AgentHive Dispatcher Agent — a senior technical manager running an
autonomous software factory. Your job is to:

1. Receive a SINGLE granular task from the queue.
2. Analyze what type of specialist is needed (backend_dev, frontend_dev,
   database_architect, qa_engineer, devops_engineer, tech_writer).
3. Spawn EXACTLY ONE worker for this task using a spawn_agent action block.
4. Provide the worker with all necessary context from past completed tasks.

RULES:
- Spawn exactly one agent per task dispatch.
- Always include the full task description in the worker's task field.
- Always include relevant context from previous tasks so the worker can
  maintain code consistency.
- Keep your analysis brief but thorough.

SPAWN FORMAT:
```action
{
  "action": "spawn_agent",
  "role": "<role>",
  "task": "<full task description with all context>",
  "instructions": "<specific technical instructions>"
}
```

Begin.
""".strip()


async def _run_dispatcher_for_task(
    task: BucketTask,
    hive: HiveSession,
    session_dir: Path,
    artifact_history: list[str],
    budget_limit: float,
    run_qa: bool,
) -> bool:
    """
    Dispatch a single task from the bucket.
    Returns True if task completed successfully, False if it failed.
    """
    hive_id = hive.id
    emit = lambda level, msg: hive.add_log(level, f"[DISPATCHER] {msg}", agent_id="system")

    emit("info", f"Dispatching task: [{task.priority}] {task.title!r}")

    # Mark task as in-progress in the queue + DB
    await db_update_task_status(task.id, "IN_PROGRESS", hive_id=hive_id)

    # Emit a bucket update event so the dashboard updates
    emit_event(
        "BUCKET_UPDATE",
        hive_id=hive_id,
        agent_id="system",
        data={
            "task_id": task.id,
            "status": "IN_PROGRESS",
            "title": task.title,
            "priority": task.priority,
        },
    )

    # Build context block from artifact history
    context_summary = ""
    if artifact_history:
        context_summary = "## Context from completed tasks:\n" + "\n\n".join(
            f"### Task {i+1}:\n{summary}" for i, summary in enumerate(artifact_history[-3:])
        )

    dispatcher_prompt = f"""
{context_summary}

## Current Task to Dispatch
**Title:** {task.title}
**Priority:** {task.priority}
**Description:**
{task.description or "(No additional description provided)"}

Analyze this task and spawn the appropriate specialist agent.
""".strip()

    # ── Spawn Manager/Dispatcher agent ────────────────────────────────────────
    manager_node = AgentNode(
        id=str(uuid.uuid4()),
        role="manager",
        session_id=hive_id,
        parent_id=None,
        status="thinking",
        specialized_task=f"Dispatch: {task.title}",
    )
    hive.register_agent(manager_node)
    emit_event("SPAWN", hive_id, manager_node.id,
               {"role": "manager", "task_preview": f"Dispatch: {task.title[:80]}"}, role="manager")
    emit_event("STATUS", hive_id, manager_node.id,
               {"status": "thinking", "role": "manager"}, role="manager")
    await db_upsert_agent(manager_node.id, hive_id, "manager", "thinking", None, task.title)

    def manager_emit(level: str, msg: str) -> None:
        hive.add_log(level, f"[MANAGER] {msg}", agent_id=manager_node.id)

    try:
        manager_agent = create_agent(
            provider=hive.provider,
            model=hive.model,
            log_emitter=manager_emit,
        )
        manager_agent.SYSTEM_PROMPT = DISPATCHER_PROMPT  # type: ignore

        manager_node.status = "working"
        emit_event("STATUS", hive_id, manager_node.id,
                   {"status": "working", "role": "manager"}, role="manager")

        emit_event("THOUGHT", hive_id, manager_node.id,
                   {"line": f"Analyzing: {task.title}"}, role="manager")

        response = await manager_agent.think(dispatcher_prompt)
        _accumulate_chars(hive_id, response)

        for line in response.split("\n"):
            line = line.strip()
            if line:
                emit_event("THOUGHT", hive_id, manager_node.id, {"line": line}, role="manager")

        # Extract spawn action
        actions = _extract_actions(response)
        spawn_actions = [a for a in actions if a.get("action") == "spawn_agent"]

        if not spawn_actions:
            manager_emit("warning", "No spawn_agent found — running task directly as backend_dev")
            spawn_actions = [{
                "action": "spawn_agent",
                "role": "backend_dev",
                "task": f"{task.title}\n\n{task.description}",
                "instructions": "Complete this task thoroughly. Write all output files.",
            }]

        # Take first spawn (we dispatch one worker per task)
        sa = spawn_actions[0]
        role = sa.get("role", "backend_dev")
        worker_task = sa.get("task", f"{task.title}\n\n{task.description}")
        instructions = sa.get("instructions", "Complete this task thoroughly.")

        worker_node = AgentNode(
            id=str(uuid.uuid4()),
            role=role,
            session_id=hive_id,
            parent_id=manager_node.id,
            status="idle",
            specialized_task=worker_task,
            local_context={"instructions": instructions},
        )
        hive.register_agent(worker_node)

        emit_event("SPAWN", hive_id, worker_node.id,
                   {"role": role, "task_preview": worker_task[:120], "parent_id": manager_node.id},
                   role=role)

        await db_upsert_agent(worker_node.id, hive_id, role, "idle", manager_node.id, worker_task)

        manager_node.status = "completed"
        emit_event("STATUS", hive_id, manager_node.id,
                   {"status": "completed", "role": "manager"}, role="manager")
        await db_upsert_agent(manager_node.id, hive_id, "manager", "completed", None, task.title)

        # ── Run Worker ────────────────────────────────────────────────────────
        await run_worker(worker_node, hive, session_dir)

        # ── QA Gate ───────────────────────────────────────────────────────────
        qa_passed = True
        if run_qa:
            emit("info", "Running QA gate...")
            qa_passed = await run_qa_agent(
                hive=hive,
                session_dir=session_dir,
                parent_id=worker_node.id,
                artifact_summary=f"Task: {task.title}\n{task.description}\n\nRole: {role}",
            )
            if qa_passed:
                emit("success", f"QA gate passed for task: {task.title!r}")
            else:
                emit("warning", f"QA gate had issues for task: {task.title!r}")

        if worker_node.status == "completed":
            await bucket_queue.mark_completed(task.id)
            emit_event(
                "BUCKET_UPDATE",
                hive_id=hive_id,
                agent_id="system",
                data={
                    "task_id": task.id,
                    "status": "COMPLETED",
                    "title": task.title,
                    "qa_passed": qa_passed,
                },
            )
            # Build artifact summary for context stitching
            summary = (
                f"**[{role.replace('_', ' ').title()}]** completed: {task.title}\n"
                f"QA: {'PASSED' if qa_passed else 'ISSUES'}\n"
                f"Task description: {task.description[:200]}"
            )
            return True, summary

        else:
            error = f"Worker {role} finished with status: {worker_node.status}"
            await bucket_queue.mark_failed(task.id, error=error)
            emit_event(
                "BUCKET_UPDATE",
                hive_id=hive_id,
                agent_id="system",
                data={"task_id": task.id, "status": "FAILED", "error": error},
            )
            return False, ""

    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.error(f"[Dispatcher] Task {task.id[:8]} failed: {error_msg}")
        emit("error", f"Task dispatch error: {error_msg}")
        await bucket_queue.mark_failed(task.id, error=error_msg)
        emit_event(
            "BUCKET_UPDATE",
            hive_id=hive_id,
            agent_id="system",
            data={"task_id": task.id, "status": "FAILED", "error": error_msg},
        )
        return False, ""


async def run_factory(
    hive: HiveSession,
    budget_limit: float = _DEFAULT_BUDGET_LIMIT,
    run_qa: bool = True,
    stop_on_failure: bool = False,
) -> None:
    """
    Main factory loop. Drains the BucketQueue until empty (or killed/stopped).
    This runs as a background asyncio task.
    """
    hive_id = hive.id
    _hive_char_counters[hive_id] = 0
    _hive_killed[hive_id] = False
    hive.status = "running"

    emit = lambda level, msg: hive.add_log(level, f"[FACTORY] {msg}", agent_id="system")

    emit("info", "AgentHive Factory starting...")
    emit("info", f"Provider: {hive.provider} | Model: {hive.model}")
    emit("info", f"Budget limit: ${budget_limit:.2f}")

    await db_upsert_hive(hive_id, "(factory mode)", hive.provider, hive.model, "running", budget_limit)

    session_dir = config.WORKSPACE_DIR / f"hive-{hive_id[:8]}"
    session_dir.mkdir(parents=True, exist_ok=True)
    emit("info", f"Workspace: {session_dir.name}")

    artifact_history: list[str] = []   # context stitching buffer
    tasks_done = 0
    tasks_failed = 0

    emit_event("FACTORY_START", hive_id, "system", {
        "provider": hive.provider,
        "model": hive.model,
        "pending": bucket_queue.get_progress()["pending"],
    })

    try:
        while True:
            # Check kill flag
            if _is_killed(hive_id):
                emit("error", "Factory killed (budget exceeded or manual stop).")
                break

            # Dequeue next task
            task = await bucket_queue.dequeue()
            if task is None:
                emit("info", "Queue empty — factory idle, waiting for new tasks...")
                # Wait for more tasks (or timeout after 30s)
                try:
                    await asyncio.wait_for(bucket_queue.wait_for_work(), timeout=30.0)
                    continue
                except asyncio.TimeoutError:
                    emit("info", "Factory idle timeout — shutting down.")
                    break

            # Dispatch the task
            success, summary = await _run_dispatcher_for_task(
                task=task,
                hive=hive,
                session_dir=session_dir,
                artifact_history=artifact_history,
                budget_limit=budget_limit,
                run_qa=run_qa,
            )

            if success:
                tasks_done += 1
                if summary:
                    artifact_history.append(summary)
                    if len(artifact_history) > 10:
                        artifact_history = artifact_history[-10:]
            else:
                tasks_failed += 1
                if stop_on_failure:
                    emit("error", f"Stopping factory due to task failure (stop_on_failure=True).")
                    break

            # Emit progress update
            progress = bucket_queue.get_progress()
            emit_event("FACTORY_PROGRESS", hive_id, "system", {
                "tasks_done": tasks_done,
                "tasks_failed": tasks_failed,
                **progress,
            })
            emit("info", f"Progress: {tasks_done} done, {tasks_failed} failed, {progress['pending']} pending")

            await asyncio.sleep(0.5)   # brief pause between tasks

    except asyncio.CancelledError:
        emit("warning", "Factory task cancelled.")
    except Exception as exc:
        emit("error", f"Factory crashed: {type(exc).__name__}: {exc}")
        logger.exception("[Factory] Unhandled error in run_factory")
    finally:
        hive.complete(success=(tasks_failed == 0))
        final_status = "completed" if tasks_failed == 0 and tasks_done > 0 else "failed"
        await db_upsert_hive(hive_id, "(factory mode)", hive.provider, hive.model, final_status, budget_limit)
        emit_event("FACTORY_DONE", hive_id, "system", {
            "tasks_done": tasks_done,
            "tasks_failed": tasks_failed,
            "hive_id": hive_id,
        })
        emit("success" if tasks_failed == 0 else "warning",
             f"Factory finished: {tasks_done} completed, {tasks_failed} failed.")
        _running_factories.pop(hive_id, None)
        _hive_char_counters.pop(hive_id, None)
        _hive_killed.pop(hive_id, None)


def is_factory_running(hive_id: str) -> bool:
    task = _running_factories.get(hive_id)
    return task is not None and not task.done()


def get_active_factory_hive_id() -> str | None:
    """Return the hive_id of the currently running factory (if any)."""
    for hid, task in _running_factories.items():
        if not task.done():
            return hid
    return None


def stop_factory(hive_id: str) -> bool:
    """Cancel the factory task for a given hive_id."""
    task = _running_factories.get(hive_id)
    if task and not task.done():
        _hive_killed[hive_id] = True
        task.cancel()
        return True
    return False


async def start_factory(
    provider: str,
    model: str,
    budget_limit: float = _DEFAULT_BUDGET_LIMIT,
    run_qa: bool = True,
    stop_on_failure: bool = False,
) -> HiveSession:
    """
    Create a HiveSession and launch the factory loop as a background task.
    Called by POST /bucket/start.
    """
    hive = session_store.create_hive(
        provider=provider,
        model=model,
        prompt="(factory mode — draining task bucket)",
    )
    task = asyncio.create_task(
        run_factory(hive, budget_limit=budget_limit, run_qa=run_qa, stop_on_failure=stop_on_failure)
    )
    _running_factories[hive.id] = task
    logger.info(f"[Dispatcher] Factory started: hive_id={hive.id}")
    return hive
