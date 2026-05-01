"""
AgentHive Engine - Bucket Dispatcher (Swarm Edition)

The Dispatcher drives the Factory loop that drains the BucketQueue.
Each task is executed by the Agent Swarm starting from the SwarmDispatcher
routine and autonomously handed off between specialist routines until the
QA Engineer calls terminate_and_report.

Flow:
  1. POST /bucket/start  → start_factory()
  2. Factory dequeues BucketTask → _run_dispatcher_for_task()
  3. SwarmContext built → run_swarm(entry="swarm_dispatcher")
  4. Routines hand off autonomously: Dispatcher → [UiUxScout | BackendDev | FrontendDev] → QA Engineer
  5. QA Engineer terminates → task marked COMPLETED → next task
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path

from app import config
from app.bucket import bucket_queue, BucketTask
from app.db import db_upsert_hive, db_upsert_agent, db_update_task_status
from app.events import emit_event
from app.hive import (
    _hive_killed,
    _hive_char_counters,
    _DEFAULT_BUDGET_LIMIT,
    _is_killed,
)
from app.session import HiveSession, session_store

from app.agents.factory import create_agent
from app.agents.prompts import get_system_prompt
from app.hive import _accumulate_chars, _extract_actions  # type: ignore[attr-defined]

logger = logging.getLogger(__name__)

# ── Factory State ──────────────────────────────────────────────────────────────
# Tracks active factory run per hive_id
_running_factories: dict[str, asyncio.Task] = {}

# Max tasks processed concurrently (tunable)
MAX_CONCURRENT_TASKS: int = 3


async def run_business_analyst(
    requirement: str,
    hive: HiveSession,
    provider: str | None = None,
    model: str | None = None,
    budget_limit: float = _DEFAULT_BUDGET_LIMIT,
    run_qa: bool = False,
) -> list[dict]:
    """
    Analyze & Plan flow — invoked by POST /hive/analyze.

    Spawns a Business Analyst agent that decomposes a business requirement
    into granular create_task blocks and enqueues them to the bucket queue.
    Then auto-starts the Agent Swarm factory on the same hive so the graph
    stays alive and tasks start executing immediately.

    Returns the list of task dicts created.
    """
    import uuid as _uuid
    from app.session import AgentNode
    from datetime import datetime as _dt

    hive_id   = hive.id
    _provider = provider or hive.provider
    _model    = model    or hive.model

    emit = lambda lvl, msg: hive.add_log(lvl, f"[ANALYZE] {msg}", agent_id="system")
    emit("info", f"Starting Analyze & Plan: {requirement[:80]}…")

    # ── Manager coordination node ──────────────────────────────────────────────
    manager_id = str(_uuid.uuid4())
    from app.events import emit_event as _emit_event
    _emit_event("PREPARING_SPAWN", hive_id, manager_id,
                {"role": "manager", "task_preview": f"Delegate: {requirement[:80]}"}, role="manager")

    manager_node = AgentNode(
        id=manager_id,
        role="manager",
        session_id=hive_id,
        parent_id=None,
        status="thinking",
        specialized_task=f"Analyze: {requirement[:80]}",
    )
    hive.register_agent(manager_node)
    _emit_event("SPAWN", hive_id, manager_id,
                {"role": "manager", "task_preview": f"Delegate: {requirement[:80]}"},
                role="manager", parent_id=None)
    _emit_event("STATUS", hive_id, manager_id, {"status": "thinking", "role": "manager"}, role="manager")
    await db_upsert_agent(manager_id, hive_id, "manager", "thinking", None, manager_node.specialized_task)

    emit("info", "[MANAGER] Delegating requirement analysis to Business Analyst…")
    await asyncio.sleep(0.3)
    manager_node.status = "working"
    _emit_event("STATUS", hive_id, manager_id, {"status": "working", "role": "manager"}, role="manager")

    # ── Business Analyst node ──────────────────────────────────────────────────
    ba_id = str(_uuid.uuid4())
    _emit_event("PREPARING_SPAWN", hive_id, ba_id,
                {"role": "business_analyst", "task_preview": f"Analyze: {requirement[:80]}",
                 "parent_id": manager_id}, role="business_analyst")

    ba_node = AgentNode(
        id=ba_id,
        role="business_analyst",
        session_id=hive_id,
        parent_id=manager_id,
        status="thinking",
        specialized_task=f"Analyze: {requirement[:80]}",
    )
    hive.register_agent(ba_node)
    _emit_event("SPAWN", hive_id, ba_id,
                {"role": "business_analyst", "task_preview": f"Analyze: {requirement[:80]}"},
                role="business_analyst", parent_id=manager_id)
    _emit_event("STATUS", hive_id, ba_id, {"status": "thinking", "role": "business_analyst"}, role="business_analyst")
    await db_upsert_agent(ba_id, hive_id, "business_analyst", "thinking", manager_id, ba_node.specialized_task)

    def ba_emit(lvl: str, msg: str) -> None:
        hive.add_log(lvl, f"[BA] {msg}", agent_id=ba_id)

    try:
        ba_node.status = "working"
        _emit_event("STATUS", hive_id, ba_id, {"status": "working", "role": "business_analyst"}, role="business_analyst")

        agent = create_agent(provider=_provider, model=_model, log_emitter=ba_emit)
        agent.SYSTEM_PROMPT = get_system_prompt("business_analyst")  # type: ignore

        ba_prompt = f"""## Business Requirement to Analyze

{requirement}

Decompose this into 4–8 granular development tasks using `create_task` action blocks.
Output ONLY action blocks. Do not write any code or explanations outside the blocks.
"""
        response = await agent.think(ba_prompt)
        _accumulate_chars(hive_id, response)

        for line in response.split("\n"):
            line = line.strip()
            if line:
                _emit_event("THOUGHT", hive_id, ba_id, {"line": line}, role="business_analyst")

        # Parse create_task blocks and enqueue
        actions = _extract_actions(response)
        created_tasks: list[dict] = []

        for action in actions:
            if action.get("action") != "create_task":
                continue
            title       = str(action.get("title", "Untitled Task"))[:200]
            description = str(action.get("description", ""))
            priority    = str(action.get("priority", "MEDIUM")).upper()
            card_type   = str(action.get("card_type", "STORY")).upper()
            if priority not in ("HIGH", "MEDIUM", "LOW"):
                priority = "MEDIUM"
            if card_type not in ("STORY", "TASK", "BUG"):
                card_type = "STORY"

            task = await bucket_queue.enqueue(
                title=title,
                description=description,
                priority=priority,
                card_type=card_type,
            )
            created_tasks.append(task.to_dict())

            _emit_event("BUCKET_UPDATE", hive_id, "system", {
                "task_id": task.id,
                "status": "PENDING",
                "title": title,
                "priority": priority,
                "source": "business_analyst",
            })
            ba_emit("success", f"Created task [{priority}]: {title[:60]}")

        # Complete BA node
        ba_node.status = "completed"
        ba_node.completed_at = _dt.utcnow().isoformat()
        _emit_event("STATUS", hive_id, ba_id, {"status": "completed", "role": "business_analyst"}, role="business_analyst")
        _emit_event("DONE",   hive_id, ba_id, {"tasks_created": len(created_tasks)}, role="business_analyst")
        await db_upsert_agent(ba_id, hive_id, "business_analyst", "completed", manager_id, ba_node.specialized_task)

        emit("success", f"Analysis complete — {len(created_tasks)} tasks queued.")

        # Complete Manager node
        manager_node.status = "completed"
        manager_node.completed_at = _dt.utcnow().isoformat()
        _emit_event("STATUS", hive_id, manager_id, {"status": "completed", "role": "manager"}, role="manager")
        await db_upsert_agent(manager_id, hive_id, "manager", "completed", None, manager_node.specialized_task)

        # Auto-start the Swarm factory on the same hive if not already running
        if created_tasks and not get_active_factory_hive_id():
            emit("info", "Auto-starting Agent Swarm factory to execute queued tasks…")
            await asyncio.sleep(0.5)
            await start_factory(
                provider=_provider,
                model=_model,
                budget_limit=budget_limit,
                run_qa=run_qa,
                stop_on_failure=False,
                existing_hive_id=hive_id,
            )
        elif get_active_factory_hive_id():
            emit("info", "Swarm factory already running — tasks added to queue.")

        return created_tasks

    except Exception as exc:
        ba_node.status = "error"
        _emit_event("STATUS", hive_id, ba_id, {"status": "error", "role": "business_analyst"}, role="business_analyst")
        manager_node.status = "error"
        _emit_event("STATUS", hive_id, manager_id, {"status": "error", "role": "manager"}, role="manager")
        emit("error", f"Business Analyst failed: {exc}")
        await db_upsert_agent(ba_id, hive_id, "business_analyst", "error", manager_id, ba_node.specialized_task)
        await db_upsert_agent(manager_id, hive_id, "manager", "error", None, manager_node.specialized_task)
        logger.exception("[BA] run_business_analyst failed")
        return []



async def _run_dispatcher_for_task(
    task: BucketTask,
    hive: HiveSession,
    session_dir: Path,
    artifact_history: list[str],
    budget_limit: float,
    run_qa: bool,
) -> tuple[bool, str]:
    """
    Dispatch a single task from the bucket using the Agent Swarm engine.
    Builds a SwarmContext from the BucketTask, runs the Swarm starting from
    the swarm_dispatcher routine, and handles bucket state transitions.
    Returns (success: bool, summary: str).
    """
    from app.swarm.core import SwarmContext, run_swarm
    from app.swarm.routines import build_default_swarm
    from app.hive import _hive_char_counters

    hive_id = hive.id
    emit = lambda level, msg: hive.add_log(level, f"[SWARM] {msg}", agent_id="system")

    emit("info", f"Swarm picking task: [{task.priority}] {task.title!r}")

    # Mark task as in-progress in queue and DB
    await db_update_task_status(task.id, "IN_PROGRESS", hive_id=hive_id)
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

    # Pass prior artifact summaries as context variables
    prior_context: dict = {}
    if artifact_history:
        prior_context["prior_tasks"] = artifact_history[-3:]

    # Estimate remaining budget
    chars_used = _hive_char_counters.get(hive_id, 0)
    cost_used = (chars_used / 4 / 1000) * 0.003
    budget_remaining = max(0.0, budget_limit - cost_used)

    # Snapshot message bus for context injection
    artifact_bus: dict = {}
    for topic, messages in hive.message_bus.get_all().items():
        if messages:
            artifact_bus[topic] = messages[-1]

    ctx = SwarmContext(
        hive_id=hive_id,
        task_id=task.id,
        task_title=task.title,
        task_description=task.description or "",
        context_variables=prior_context,
        artifact_bus=artifact_bus,
        session_dir=session_dir,
        budget_remaining=budget_remaining,
        hive=hive,
    )

    try:
        routines = build_default_swarm()
        final_output = await run_swarm(
            routines=routines,
            entry_role="swarm_dispatcher",
            ctx=ctx,
        )
        await bucket_queue.mark_completed(task.id)
        emit_event(
            "BUCKET_UPDATE",
            hive_id=hive_id,
            agent_id="system",
            data={"task_id": task.id, "status": "COMPLETED", "title": task.title},
        )
        summary = f"[Swarm] {task.title}: {final_output[:300]}"
        emit("success", f"Swarm completed: {task.title!r}")
        return True, summary

    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.error("[Swarm] Task %s failed: %s", task.id[:8], error_msg)
        emit("error", f"Swarm error: {error_msg}")
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
    Main factory loop — drains BucketQueue with parallel task execution.
    Up to MAX_CONCURRENT_TASKS tasks run concurrently via asyncio.Semaphore.
    """
    hive_id = hive.id
    _hive_char_counters[hive_id] = 0
    _hive_killed[hive_id] = False
    hive.status = "running"

    emit = lambda level, msg: hive.add_log(level, f"[FACTORY] {msg}", agent_id="system")

    emit("info", "AgentHive Factory starting (parallel mode)...")
    emit("info", f"Provider: {hive.provider} | Model: {hive.model}")
    emit("info", f"Budget limit: ${budget_limit:.2f} | Concurrency: {MAX_CONCURRENT_TASKS}")

    await db_upsert_hive(hive_id, "(factory mode)", hive.provider, hive.model, "running", budget_limit)

    session_dir = config.WORKSPACE_DIR / f"hive-{hive_id[:8]}"
    session_dir.mkdir(parents=True, exist_ok=True)
    emit("info", f"Workspace: {session_dir.name}")

    artifact_history: list[str] = []
    tasks_done = 0
    tasks_failed = 0
    active_tasks: dict[str, asyncio.Task] = {}   # task_id → asyncio.Task
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)

    emit_event("FACTORY_START", hive_id, "system", {
        "provider": hive.provider,
        "model": hive.model,
        "pending": bucket_queue.get_progress()["pending"],
        "concurrency": MAX_CONCURRENT_TASKS,
    })

    async def _run_task_guarded(task: "BucketTask") -> tuple[bool, str]:
        """Run a single task inside the semaphore so concurrency stays bounded."""
        async with semaphore:
            if _is_killed(hive_id):
                return False, ""
            return await _run_dispatcher_for_task(
                task=task,
                hive=hive,
                session_dir=session_dir,
                artifact_history=artifact_history,
                budget_limit=budget_limit,
                run_qa=run_qa,
            )

    def _on_task_done(task_id: str, fut: asyncio.Task) -> None:
        """Callback fired when a guarded task finishes."""
        nonlocal tasks_done, tasks_failed
        active_tasks.pop(task_id, None)
        try:
            success, summary = fut.result()
            if success:
                tasks_done += 1
                if summary:
                    artifact_history.append(summary)
                    if len(artifact_history) > 10:
                        artifact_history[:] = artifact_history[-10:]
            else:
                tasks_failed += 1
            progress = bucket_queue.get_progress()
            emit_event("FACTORY_PROGRESS", hive_id, "system", {
                "tasks_done": tasks_done,
                "tasks_failed": tasks_failed,
                **progress,
            })
            emit("info", f"Progress: {tasks_done} done, {tasks_failed} failed, {progress['pending']} pending")
            if not success and stop_on_failure:
                _hive_killed[hive_id] = True
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            tasks_failed += 1
            emit("error", f"Task result error: {exc}")

    try:
        while True:
            if _is_killed(hive_id):
                emit("error", "Factory killed (budget exceeded or manual stop).")
                break

            # Drain queue: enqueue as many tasks as the semaphore allows
            dequeued_any = False
            while len(active_tasks) < MAX_CONCURRENT_TASKS:
                task = await bucket_queue.dequeue()
                if task is None:
                    break
                dequeued_any = True
                fut = asyncio.create_task(_run_task_guarded(task))
                active_tasks[task.id] = fut
                fut.add_done_callback(lambda f, tid=task.id: _on_task_done(tid, f))
                emit("info", f"[⨂] Dispatching task in parallel: {task.title[:60]}")

            if not dequeued_any and not active_tasks:
                emit("info", "Queue empty — factory idle, waiting for new tasks...")
                try:
                    await asyncio.wait_for(bucket_queue.wait_for_work(), timeout=30.0)
                    continue
                except asyncio.TimeoutError:
                    emit("info", "Factory idle timeout — shutting down.")
                    break

            # Yield control so active tasks can make progress
            await asyncio.sleep(0.5)

    except asyncio.CancelledError:
        emit("warning", "Factory task cancelled.")
        # Cancel all active tasks gracefully
        for fut in active_tasks.values():
            fut.cancel()
        if active_tasks:
            await asyncio.gather(*active_tasks.values(), return_exceptions=True)
    except Exception as exc:
        emit("error", f"Factory crashed: {type(exc).__name__}: {exc}")
        logger.exception("[Factory] Unhandled error in run_factory")
    finally:
        # Wait for any still-running tasks
        if active_tasks:
            await asyncio.gather(*active_tasks.values(), return_exceptions=True)
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
    run_qa: bool = False,
    stop_on_failure: bool = False,
    existing_hive_id: str | None = None,
) -> HiveSession:
    """
    Create (or reuse) a HiveSession and launch the factory loop as a background task.
    If existing_hive_id is given and the session exists, the factory runs inside that
    session so the Orchestration graph stays on the same hive.
    Called by POST /bucket/start.
    """
    # Reuse an existing session if requested
    if existing_hive_id:
        hive = session_store.get_hive(existing_hive_id)
        if hive is None:
            # Session expired — create a fresh one with the same id
            hive = session_store.create_hive(
                provider=provider,
                model=model,
                prompt="(factory mode — draining task bucket)",
                hive_id=existing_hive_id,
            )
    else:
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
