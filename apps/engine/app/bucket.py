"""
AgentHive Engine - Task Bucket Queue (Phase 5)

In-process priority queue seeded from PostgreSQL.
The BucketQueue is the heart of the autonomous dispatcher loop.

Priority order (highest first): HIGH → MEDIUM → LOW
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from app.db import (
    db_create_task,
    db_list_tasks,
    db_update_task_status,
    db_increment_task_retry,
    db_create_debug_task,
    db_get_bucket_progress,
    db_delete_task,
)

logger = logging.getLogger(__name__)

# Priority sort weight (lower = picked first)
_PRIORITY_WEIGHT = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


@dataclass
class BucketTask:
    """In-memory representation of a task bucket item."""
    id: str
    title: str
    description: str = ""
    priority: str = "MEDIUM"          # HIGH | MEDIUM | LOW
    status: str = "PENDING"           # PENDING | IN_PROGRESS | COMPLETED | FAILED | CANCELLED
    hive_id: str | None = None
    assigned_agent_id: str | None = None
    assigned_role: str | None = None
    error_log: str | None = None
    retry_count: int = 0
    max_retries: int = 2
    parent_task_id: str | None = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    @property
    def _sort_key(self) -> tuple[int, str]:
        return (_PRIORITY_WEIGHT.get(self.priority, 1), self.created_at)

    @classmethod
    def from_db(cls, row: dict) -> "BucketTask":
        return cls(
            id=row["id"],
            title=row["title"],
            description=row.get("description", ""),
            priority=row.get("priority", "MEDIUM"),
            status=row.get("status", "PENDING"),
            hive_id=row.get("hive_id"),
            assigned_agent_id=row.get("assigned_agent_id"),
            assigned_role=row.get("assigned_role"),
            error_log=row.get("error_log"),
            retry_count=row.get("retry_count", 0),
            max_retries=row.get("max_retries", 2),
            parent_task_id=row.get("parent_task_id"),
            created_at=str(row.get("created_at", datetime.utcnow().isoformat())),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "status": self.status,
            "hive_id": self.hive_id,
            "assigned_agent_id": self.assigned_agent_id,
            "assigned_role": self.assigned_role,
            "error_log": self.error_log,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "parent_task_id": self.parent_task_id,
            "created_at": self.created_at,
        }


class BucketQueue:
    """
    Singleton in-process task queue.
    All tasks are mirrored to PostgreSQL (when available) for persistence.
    An asyncio.Event is used to wake up the dispatcher when new tasks arrive.
    """

    def __init__(self) -> None:
        self._tasks: dict[str, BucketTask] = {}   # id → task
        self._wakeup = asyncio.Event()
        self._lock = asyncio.Lock()
        # Subscriber callbacks  ─ list[Callable[[list[BucketTask]], None]]
        self._subscribers: list[Callable[[list[BucketTask]], None]] = []

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def load_from_db(self) -> None:
        """Seed the in-memory queue from Postgres on engine startup."""
        rows = await db_list_tasks()          # all statuses
        async with self._lock:
            for row in rows:
                task = BucketTask.from_db(row)
                # Reset any orphaned IN_PROGRESS tasks to PENDING
                if task.status == "IN_PROGRESS":
                    task.status = "PENDING"
                    await db_update_task_status(task.id, "PENDING")
                self._tasks[task.id] = task
        count = len(self._tasks)
        logger.info(f"[Bucket] Loaded {count} tasks from database")
        self._notify()

    # ── CRUD ─────────────────────────────────────────────────────────────────

    async def enqueue(
        self,
        title: str,
        description: str = "",
        priority: str = "MEDIUM",
        task_id: str | None = None,
        parent_task_id: str | None = None,
    ) -> BucketTask:
        """Create and enqueue a new task."""
        tid = task_id or str(uuid.uuid4())
        task = BucketTask(
            id=tid,
            title=title,
            description=description,
            priority=priority.upper(),
            status="PENDING",
            parent_task_id=parent_task_id,
        )
        async with self._lock:
            self._tasks[tid] = task

        # Persist to DB (best-effort)
        await db_create_task(
            task_id=tid,
            title=title,
            description=description,
            priority=priority.upper(),
            parent_task_id=parent_task_id,
        )

        logger.info(f"[Bucket] Enqueued task: [{priority.upper()}] {title!r} ({tid[:8]})")
        self._notify()
        return task

    async def delete(self, task_id: str) -> bool:
        """Remove a task (only if PENDING or FAILED)."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return False
            if task.status == "IN_PROGRESS":
                return False   # can't remove an active task
            del self._tasks[task_id]
        await db_delete_task(task_id)
        self._notify()
        return True

    async def update(
        self,
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        priority: str | None = None,
    ) -> BucketTask | None:
        """Update task metadata (title, description, priority). No status change."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            if title is not None:
                task.title = title
            if description is not None:
                task.description = description
            if priority is not None:
                task.priority = priority.upper()

        # Persist
        from app.db import db_update_task
        kwargs: dict[str, Any] = {}
        if title is not None:
            kwargs["title"] = title
        if description is not None:
            kwargs["description"] = description
        if priority is not None:
            kwargs["priority"] = priority.upper()
        if kwargs:
            await db_update_task(task_id, **kwargs)

        self._notify()
        return task

    # ── Queue Logic ──────────────────────────────────────────────────────────

    def _pending_sorted(self) -> list[BucketTask]:
        """Return PENDING tasks sorted by priority then creation time."""
        pending = [t for t in self._tasks.values() if t.status == "PENDING"]
        return sorted(pending, key=lambda t: t._sort_key)

    async def dequeue(self) -> BucketTask | None:
        """
        Pop the highest-priority PENDING task and mark it IN_PROGRESS.
        Returns None if queue is empty. Blocks until woken by next enqueue.
        """
        async with self._lock:
            candidates = self._pending_sorted()
            if not candidates:
                return None
            task = candidates[0]
            task.status = "IN_PROGRESS"

        await db_update_task_status(task.id, "IN_PROGRESS")
        logger.info(f"[Bucket] Dequeued: [{task.priority}] {task.title!r} ({task.id[:8]})")
        self._notify()
        return task

    async def wait_for_work(self) -> None:
        """Async-wait until there is at least one PENDING task."""
        while not self._pending_sorted():
            self._wakeup.clear()
            await self._wakeup.wait()

    async def mark_completed(self, task_id: str) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = "COMPLETED"
        await db_update_task_status(task_id, "COMPLETED")
        logger.info(f"[Bucket] Completed task {task_id[:8]}")
        self._notify()

    async def mark_failed(
        self,
        task_id: str,
        error: str = "",
        auto_debug: bool = True,
    ) -> None:
        """Mark task as failed. If retry_count < max_retries, re-enqueue as PENDING.
        Otherwise create a debug task and mark as FAILED."""
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.retry_count += 1
            task.error_log = error[:4000]

        new_count = await db_increment_task_retry(task_id)

        if new_count <= task.max_retries:
            # Re-queue for retry
            async with self._lock:
                task.status = "PENDING"
            await db_update_task_status(task_id, "PENDING", error_log=error)
            logger.info(f"[Bucket] Retrying task {task_id[:8]} (attempt {new_count}/{task.max_retries})")
            self._notify()
        else:
            # Max retries exhausted — mark FAILED
            async with self._lock:
                task.status = "FAILED"
            await db_update_task_status(task_id, "FAILED", error_log=error)
            logger.warning(f"[Bucket] Task {task_id[:8]} permanently failed after {new_count} retries")

            if auto_debug:
                # Automatically create a HIGH priority debug task
                debug_row = await db_create_debug_task(task_id, task.title, error)
                if debug_row:
                    debug_task = BucketTask.from_db(debug_row)
                    async with self._lock:
                        self._tasks[debug_task.id] = debug_task
                    logger.info(f"[Bucket] Created debug task for {task_id[:8]}: {debug_task.id[:8]}")
                    self._notify()

    # ── Introspection ────────────────────────────────────────────────────────

    def all_tasks(self) -> list[BucketTask]:
        return list(self._tasks.values())

    def get_progress(self) -> dict:
        tasks = list(self._tasks.values())
        counts = {s: 0 for s in ("PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED")}
        for t in tasks:
            counts[t.status] = counts.get(t.status, 0) + 1
        total = len(tasks)
        done  = counts["COMPLETED"]
        pct   = round((done / total) * 100, 1) if total else 0
        return {
            **{k.lower(): v for k, v in counts.items()},
            "total": total,
            "progress_pct": pct,
        }

    # ── Pub/Sub for dashboard SSE ────────────────────────────────────────────

    def subscribe(self, cb: Callable[[list[BucketTask]], None]) -> None:
        """Register a callback invoked whenever queue state changes."""
        self._subscribers.append(cb)

    def unsubscribe(self, cb: Callable[[list[BucketTask]], None]) -> None:
        try:
            self._subscribers.remove(cb)
        except ValueError:
            pass

    def _notify(self) -> None:
        self._wakeup.set()
        snapshot = self.all_tasks()
        for cb in list(self._subscribers):
            try:
                cb(snapshot)
            except Exception:
                pass


# ── Singleton ─────────────────────────────────────────────────────────────────
bucket_queue = BucketQueue()
