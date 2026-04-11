"""
AgentHive Engine - Database Persistence Layer (Phase 5)
Thin async wrappers around Prisma (or a fallback no-op if Prisma unavailable).

Schema location: packages/database/prisma/schema.prisma
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

_prisma_available = False
_db = None


async def _get_db():
    """Lazy-init Prisma client. Returns None if not configured."""
    global _prisma_available, _db
    if _db is not None:
        return _db
    from app import config
    if not config.DATABASE_URL:
        return None
    try:
        from prisma import Prisma
        _db = Prisma()
        await _db.connect()
        _prisma_available = True
        logger.info("[DB] Prisma connected to PostgreSQL")
        return _db
    except ImportError:
        logger.warning("[DB] prisma package not installed — persistence disabled")
        return None
    except Exception as exc:
        logger.warning(f"[DB] Prisma connection failed: {exc} — persistence disabled")
        return None


async def db_upsert_hive(
    hive_id: str,
    prompt: str,
    provider: str,
    model: str,
    status: str,
    budget_limit: float = 2.0,
) -> None:
    """Create or update a HiveSession record."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.hivesession.upsert(
            where={"id": hive_id},
            data={
                "create": {
                    "id": hive_id,
                    "prompt": prompt,
                    "provider": provider,
                    "model": model,
                    "status": status,
                    "budget_limit": budget_limit,
                    "created_at": datetime.utcnow(),
                },
                "update": {"status": status},
            },
        )
    except Exception as exc:
        logger.debug(f"[DB] upsert_hive failed: {exc}")


async def db_upsert_agent(
    agent_id: str,
    hive_id: str,
    role: str,
    status: str,
    parent_id: str | None,
    task: str,
) -> None:
    """Create or update an AgentNode record."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.agentnode.upsert(
            where={"id": agent_id},
            data={
                "create": {
                    "id": agent_id,
                    "hive_id": hive_id,
                    "role": role,
                    "status": status,
                    "parent_id": parent_id,
                    "task": task[:2000],
                    "created_at": datetime.utcnow(),
                },
                "update": {"status": status},
            },
        )
    except Exception as exc:
        logger.debug(f"[DB] upsert_agent failed: {exc}")


async def db_append_log(
    hive_id: str,
    agent_id: str,
    level: str,
    message: str,
    metadata: dict | None = None,
) -> None:
    """Append a log entry."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.sessionlog.create(
            data={
                "hive_id": hive_id,
                "agent_id": agent_id,
                "level": level,
                "message": message[:4000],
                "metadata": json.dumps(metadata or {}),
                "timestamp": datetime.utcnow(),
            }
        )
    except Exception as exc:
        logger.debug(f"[DB] append_log failed: {exc}")


async def db_save_token_usage(
    hive_id: str,
    provider: str,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float,
) -> None:
    """Record token usage for cost tracking."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.tokenusage.create(
            data={
                "hive_id": hive_id,
                "provider": provider,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
                "cost_usd": cost_usd,
                "recorded_at": datetime.utcnow(),
            }
        )
    except Exception as exc:
        logger.debug(f"[DB] save_token_usage failed: {exc}")


async def db_get_hive_cost(hive_id: str) -> float:
    """Return total USD cost accumulated for this hive."""
    db = await _get_db()
    if not db:
        return 0.0
    try:
        result = await db.tokenusage.aggregate(
            where={"hive_id": hive_id},
            sum={"cost_usd": True},
        )
        return float(result.sum.cost_usd or 0.0)
    except Exception:
        return 0.0


async def db_list_hives(limit: int = 50) -> list[dict]:
    """Return recent hive sessions from DB."""
    db = await _get_db()
    if not db:
        return []
    try:
        rows = await db.hivesession.find_many(
            order={"created_at": "desc"},
            take=limit,
        )
        return [r.dict() for r in rows]
    except Exception:
        return []


async def db_get_hive_detail(hive_id: str) -> dict | None:
    """Return full hive detail including agents and logs."""
    db = await _get_db()
    if not db:
        return None
    try:
        row = await db.hivesession.find_unique(
            where={"id": hive_id},
            include={"agents": True, "logs": {"take": 500, "order": {"timestamp": "asc"}}},
        )
        return row.dict() if row else None
    except Exception:
        return None


async def disconnect_db() -> None:
    """Gracefully close the Prisma connection."""
    global _db
    if _db:
        try:
            await _db.disconnect()
        except Exception:
            pass
        _db = None


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 5 — Task Bucket CRUD
# ═══════════════════════════════════════════════════════════════════════════════

async def db_create_task(
    task_id: str,
    title: str,
    description: str = "",
    priority: str = "MEDIUM",
    parent_task_id: str | None = None,
) -> dict | None:
    """Insert a new task into the bucket. Returns the created record dict or None."""
    db = await _get_db()
    if not db:
        return None
    try:
        row = await db.taskbucket.create(
            data={
                "id": task_id,
                "title": title,
                "description": description,
                "priority": priority.upper(),
                "status": "PENDING",
                "parent_task_id": parent_task_id,
                "created_at": datetime.utcnow(),
            }
        )
        return row.dict()
    except Exception as exc:
        logger.debug(f"[DB] create_task failed: {exc}")
        return None


async def db_list_tasks(
    status: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """List tasks from the bucket, optionally filtered by status."""
    db = await _get_db()
    if not db:
        return []
    try:
        where: dict[str, Any] = {}
        if status:
            where["status"] = status.upper()
        rows = await db.taskbucket.find_many(
            where=where,
            order={"created_at": "asc"},
            take=limit,
        )
        return [r.dict() for r in rows]
    except Exception as exc:
        logger.debug(f"[DB] list_tasks failed: {exc}")
        return []


async def db_get_task(task_id: str) -> dict | None:
    """Fetch a single task by ID."""
    db = await _get_db()
    if not db:
        return None
    try:
        row = await db.taskbucket.find_unique(where={"id": task_id})
        return row.dict() if row else None
    except Exception as exc:
        logger.debug(f"[DB] get_task failed: {exc}")
        return None


async def db_update_task(
    task_id: str,
    **fields: Any,
) -> dict | None:
    """Generic task update. Pass keyword args matching Prisma column names."""
    db = await _get_db()
    if not db:
        return None
    try:
        row = await db.taskbucket.update(
            where={"id": task_id},
            data=fields,
        )
        return row.dict() if row else None
    except Exception as exc:
        logger.debug(f"[DB] update_task failed: {exc}")
        return None


async def db_update_task_status(
    task_id: str,
    status: str,
    hive_id: str | None = None,
    assigned_agent_id: str | None = None,
    assigned_role: str | None = None,
    error_log: str | None = None,
) -> None:
    """Convenience wrapper: update task status + optional assignment fields."""
    db = await _get_db()
    if not db:
        return
    try:
        data: dict[str, Any] = {"status": status.upper()}
        if hive_id:
            data["hive_id"] = hive_id
        if assigned_agent_id:
            data["assigned_agent_id"] = assigned_agent_id
        if assigned_role:
            data["assigned_role"] = assigned_role
        if error_log is not None:
            data["error_log"] = error_log[:4000]
        if status.upper() == "IN_PROGRESS":
            data["started_at"] = datetime.utcnow()
        elif status.upper() in ("COMPLETED", "FAILED", "CANCELLED"):
            data["completed_at"] = datetime.utcnow()
        await db.taskbucket.update(where={"id": task_id}, data=data)
    except Exception as exc:
        logger.debug(f"[DB] update_task_status failed: {exc}")


async def db_increment_task_retry(task_id: str) -> int:
    """Increment retry_count for a failed task. Returns new retry count."""
    db = await _get_db()
    if not db:
        return 0
    try:
        row = await db.taskbucket.update(
            where={"id": task_id},
            data={"retry_count": {"increment": 1}},
        )
        return row.retry_count if row else 0
    except Exception as exc:
        logger.debug(f"[DB] increment_task_retry failed: {exc}")
        return 0


async def db_create_debug_task(
    parent_task_id: str,
    parent_title: str,
    error_summary: str,
) -> dict | None:
    """Create a HIGH priority debug task when a parent task fails."""
    import uuid as _uuid
    debug_id = str(_uuid.uuid4())
    return await db_create_task(
        task_id=debug_id,
        title=f"Fix error in: {parent_title[:60]}",
        description=(
            f"Auto-created debug task.\n\n"
            f"**Failed task:** {parent_task_id}\n\n"
            f"**Error summary:**\n```\n{error_summary[:1000]}\n```\n\n"
            f"Investigate the error, apply a fix, and verify it resolves the original task."
        ),
        priority="HIGH",
        parent_task_id=parent_task_id,
    )


async def db_delete_task(task_id: str) -> bool:
    """Delete a task from the bucket."""
    db = await _get_db()
    if not db:
        return False
    try:
        await db.taskbucket.delete(where={"id": task_id})
        return True
    except Exception as exc:
        logger.debug(f"[DB] delete_task failed: {exc}")
        return False


async def db_get_bucket_progress() -> dict:
    """Return counts by status for the progress bar."""
    db = await _get_db()
    if not db:
        return {"pending": 0, "in_progress": 0, "completed": 0, "failed": 0, "total": 0}
    try:
        rows = await db.taskbucket.group_by(
            by=["status"],
            count={"id": True},
        )
        counts: dict[str, int] = {r.status.lower(): r._count["id"] for r in rows}
        total = sum(counts.values())
        return {
            "pending":     counts.get("pending", 0),
            "in_progress": counts.get("in_progress", 0),
            "completed":   counts.get("completed", 0),
            "failed":      counts.get("failed", 0),
            "cancelled":   counts.get("cancelled", 0),
            "total":       total,
        }
    except Exception as exc:
        logger.debug(f"[DB] get_bucket_progress failed: {exc}")
        return {"pending": 0, "in_progress": 0, "completed": 0, "failed": 0, "total": 0}
