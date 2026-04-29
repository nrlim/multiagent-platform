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


async def db_get_token_summary(hive_id: str) -> dict:
    """Return aggregated token stats for a hive session."""
    db = await _get_db()
    if not db:
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}
    try:
        result = await db.tokenusage.aggregate(
            where={"hive_id": hive_id},
            sum={
                "prompt_tokens": True,
                "completion_tokens": True,
                "total_tokens": True,
                "cost_usd": True,
            },
        )
        s = result.sum
        return {
            "prompt_tokens":     int(s.prompt_tokens or 0),
            "completion_tokens": int(s.completion_tokens or 0),
            "total_tokens":      int(s.total_tokens or 0),
            "cost_usd":          float(s.cost_usd or 0.0),
        }
    except Exception as exc:
        logger.debug(f"[DB] get_token_summary failed: {exc}")
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}


# ─── QA Results ───────────────────────────────────────────────────────────────

async def db_save_qa_result(
    hive_id: str,
    agent_id: str,
    test_file: str,
    passed: bool,
    output: str,
) -> None:
    """Persist the outcome of a QA agent test run."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.qaresult.create(
            data={
                "hive_id":   hive_id,
                "agent_id":  agent_id,
                "test_file": test_file,
                "passed":    passed,
                "output":    output[:8000],  # cap at 8k chars
            }
        )
        logger.info(f"[DB] QA result saved: hive={hive_id[:8]} passed={passed}")
    except Exception as exc:
        logger.debug(f"[DB] save_qa_result failed: {exc}")


async def db_get_qa_results(hive_id: str) -> list[dict]:
    """Fetch all QA results for a hive session."""
    db = await _get_db()
    if not db:
        return []
    try:
        rows = await db.qaresult.find_many(
            where={"hive_id": hive_id},
            order={"created_at": "asc"},
        )
        return [
            {
                "id":         r.id,
                "hive_id":    r.hive_id,
                "agent_id":   r.agent_id,
                "test_file":  r.test_file,
                "passed":     r.passed,
                "output":     r.output,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    except Exception as exc:
        logger.debug(f"[DB] get_qa_results failed: {exc}")
        return []


# ─── Review Requests ──────────────────────────────────────────────────────────

async def db_save_review_request(
    hive_id: str,
    agent_id: str,
    review_id: str,
    summary: str,
) -> None:
    """Persist a new human-in-the-loop review request (status=pending)."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.reviewrequest.create(
            data={
                "id":       review_id,
                "hive_id":  hive_id,
                "agent_id": agent_id,
                "status":   "pending",
                "summary":  summary[:2000],
            }
        )
        logger.info(f"[DB] ReviewRequest created: id={review_id[:8]} hive={hive_id[:8]}")
    except Exception as exc:
        logger.debug(f"[DB] save_review_request failed: {exc}")


async def db_resolve_review_request(
    hive_id: str,
    approved: bool,
    reviewer_note: str = "",
) -> None:
    """Mark the most recent pending ReviewRequest for this hive as resolved."""
    db = await _get_db()
    if not db:
        return
    try:
        # Find the latest pending review for this hive
        row = await db.reviewrequest.find_first(
            where={"hive_id": hive_id, "status": "pending"},
            order={"created_at": "desc"},
        )
        if not row:
            return
        await db.reviewrequest.update(
            where={"id": row.id},
            data={
                "status":        "approved" if approved else "rejected",
                "resolved_at":   datetime.utcnow(),
                "reviewer_note": reviewer_note or ("Auto-approved (timeout)" if approved else "Rejected"),
            },
        )
        logger.info(f"[DB] ReviewRequest resolved: id={row.id[:8]} approved={approved}")
    except Exception as exc:
        logger.debug(f"[DB] resolve_review_request failed: {exc}")


async def db_get_review_requests(hive_id: str) -> list[dict]:
    """Fetch all review requests for a hive session."""
    db = await _get_db()
    if not db:
        return []
    try:
        rows = await db.reviewrequest.find_many(
            where={"hive_id": hive_id},
            order={"created_at": "desc"},
        )
        return [
            {
                "id":            r.id,
                "hive_id":       r.hive_id,
                "agent_id":      r.agent_id,
                "status":        r.status,
                "summary":       r.summary,
                "created_at":    r.created_at.isoformat() if r.created_at else None,
                "resolved_at":   r.resolved_at.isoformat() if r.resolved_at else None,
                "reviewer_note": r.reviewer_note,
            }
            for r in rows
        ]
    except Exception as exc:
        logger.debug(f"[DB] get_review_requests failed: {exc}")
        return []




async def db_list_hives(limit: int = 50) -> list[dict]:
    """Return recent hive sessions from DB — safe flat dicts only."""
    db = await _get_db()
    if not db:
        return []
    try:
        rows = await db.hivesession.find_many(
            order={"created_at": "desc"},
            take=limit,
        )
        result = []
        for r in rows:
            result.append({
                "id":           r.id,
                "prompt":       r.prompt,
                "provider":     r.provider,
                "model":        r.model,
                "status":       r.status,
                "budget_limit": r.budget_limit,
                "created_at":   r.created_at.isoformat() if r.created_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                # agents/logs not included at list level — too heavy
                "agents": [],
                "logs":   [],
            })
        return result
    except Exception as exc:
        logger.warning(f"[DB] list_hives failed: {exc}")
        return []


async def db_get_hive_detail(hive_id: str) -> dict | None:
    """Return full hive detail including agents. Returns None if not found."""
    db = await _get_db()
    if not db:
        return None
    try:
        row = await db.hivesession.find_unique(
            where={"id": hive_id},
            include={"agents": True},
        )
        if not row:
            return None
        agents = []
        for a in (row.agents or []):
            agents.append({
                "id":               a.id,
                "role":             a.role,
                "status":           a.status,
                "session_id":       a.hive_id,
                "parent_id":        a.parent_id,
                "specialized_task": a.task,
                "children":         [],
                "created_at":       a.created_at.isoformat() if a.created_at else None,
                "completed_at":     None,
                "local_context":    {},
            })
        return {
            "id":           row.id,
            "prompt":       row.prompt,
            "provider":     row.provider,
            "model":        row.model,
            "status":       row.status,
            "budget_limit": row.budget_limit,
            "created_at":   row.created_at.isoformat() if row.created_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "agents":       agents,
            "log_count":    0,   # omit logs at detail level too — use SSE stream instead
        }
    except Exception as exc:
        logger.warning(f"[DB] get_hive_detail failed: {exc}")
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


async def db_save_workspace_file(
    hive_id: str,
    agent_id: str,
    path: str,
    size_bytes: int = 0,
    mime_type: str = "text/plain",
    is_directory: bool = False,
) -> None:
    """Upsert a workspace file metadata record (create or update size/mime)."""
    db = await _get_db()
    if not db:
        return
    try:
        await db.workspacefile.upsert(
            where={"hive_id_path": {"hive_id": hive_id, "path": path}},  # type: ignore
            data={
                "create": {
                    "hive_id":      hive_id,
                    "agent_id":     agent_id,
                    "path":         path,
                    "size_bytes":   size_bytes,
                    "mime_type":    mime_type,
                    "is_directory": is_directory,
                    "created_at":   datetime.utcnow(),
                },
                "update": {
                    "size_bytes": size_bytes,
                    "mime_type":  mime_type,
                    "agent_id":   agent_id,
                },
            },
        )
    except Exception as exc:
        # Fallback: try plain create (upsert may fail if no unique index on hive_id+path)
        try:
            await db.workspacefile.create(data={
                "hive_id":      hive_id,
                "agent_id":     agent_id,
                "path":         path,
                "size_bytes":   size_bytes,
                "mime_type":    mime_type,
                "is_directory": is_directory,
                "created_at":   datetime.utcnow(),
            })
        except Exception:
            pass
        logger.debug(f"[DB] save_workspace_file upsert fallback: {exc}")


async def db_list_workspace_files(hive_id: str) -> list[dict]:
    """Return all workspace file metadata records for a given hive session."""
    db = await _get_db()
    if not db:
        return []
    try:
        rows = await db.workspacefile.find_many(
            where={"hive_id": hive_id},
            order={"path": "asc"},
        )
        return [
            {
                "path":         r.path,
                "size_bytes":   r.size_bytes,
                "mime_type":    r.mime_type,
                "is_directory": r.is_directory,
                "agent_id":     r.agent_id,
                "updated_at":   r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    except Exception as exc:
        logger.debug(f"[DB] list_workspace_files failed: {exc}")
        return []




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

# ═══════════════════════════════════════════════════════════════════════════════
#  System Settings
# ═══════════════════════════════════════════════════════════════════════════════

async def db_get_system_settings() -> dict:
    """Get the global platform settings."""
    db = await _get_db()
    default_settings = {
        "provider": "google",
        "model": "",
        "google_key": "",
        "openai_key": "",
        "anthropic_key": "",
        "deepseek_key": "",
        "budget_limit": 2.0,
        "run_qa": True,
        "require_review": False
    }
    if not db:
        return default_settings
    try:
        row = await db.systemsettings.find_unique(where={"id": "global"})
        if not row:
            return default_settings
        return {
            "provider": row.provider,
            "model": row.model,
            "google_key": row.google_key or "",
            "openai_key": row.openai_key or "",
            "anthropic_key": row.anthropic_key or "",
            "deepseek_key": row.deepseek_key or "",
            "budget_limit": row.budget_limit,
            "run_qa": row.run_qa,
            "require_review": row.require_review
        }
    except Exception as exc:
        logger.debug(f"[DB] get_system_settings failed: {exc}")
        return default_settings


async def db_upsert_system_settings(data: dict) -> dict:
    """Upsert global platform settings."""
    db = await _get_db()
    if not db:
        return data
    try:
        update_data = {}
        for k in ["provider", "model", "google_key", "openai_key", "anthropic_key", "deepseek_key", "budget_limit", "run_qa", "require_review"]:
            if k in data:
                update_data[k] = data[k]
        
        row = await db.systemsettings.upsert(
            where={"id": "global"},
            data={
                "create": {
                    "id": "global",
                    "provider": data.get("provider", "google"),
                    "model": data.get("model", ""),
                    "google_key": data.get("google_key", ""),
                    "openai_key": data.get("openai_key", ""),
                    "anthropic_key": data.get("anthropic_key", ""),
                    "deepseek_key": data.get("deepseek_key", ""),
                    "budget_limit": data.get("budget_limit", 2.0),
                    "run_qa": data.get("run_qa", True),
                    "require_review": data.get("require_review", False),
                },
                "update": update_data
            }
        )
        return {
            "provider": row.provider,
            "model": row.model,
            "google_key": row.google_key or "",
            "openai_key": row.openai_key or "",
            "anthropic_key": row.anthropic_key or "",
            "deepseek_key": row.deepseek_key or "",
            "budget_limit": row.budget_limit,
            "run_qa": row.run_qa,
            "require_review": row.require_review
        }
    except Exception as exc:
        logger.debug(f"[DB] upsert_system_settings failed: {exc}")
        return data


# ═══════════════════════════════════════════════════════════════════════════════
#  Session Workspace Snapshot (JSON blob per session)
# ═══════════════════════════════════════════════════════════════════════════════

async def db_get_session_workspace(hive_id: str) -> dict | None:
    """
    Fetch the workspace snapshot for a session.
    Returns dict with files_json (str) and file_count (int), or None if not found.
    """
    db = await _get_db()
    if not db:
        return None
    try:
        row = await db.sessionworkspace.find_unique(where={"hive_id": hive_id})
        if not row:
            return None
        return {
            "hive_id": row.hive_id,
            "files_json": row.files_json,
            "file_count": row.file_count,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    except Exception as exc:
        logger.debug(f"[DB] get_session_workspace failed: {exc}")
        return None


async def db_upsert_session_workspace(hive_id: str, files_json: str, file_count: int = 0) -> dict:
    """
    Upsert the entire workspace file tree (as JSON string) for a session.
    One row per session — clean, simple, and immediately queryable from the dashboard.
    """
    db = await _get_db()
    if not db:
        return {"hive_id": hive_id, "files_json": files_json, "file_count": file_count}
    try:
        row = await db.sessionworkspace.upsert(
            where={"hive_id": hive_id},
            data={
                "create": {
                    "hive_id": hive_id,
                    "files_json": files_json,
                    "file_count": file_count,
                },
                "update": {
                    "files_json": files_json,
                    "file_count": file_count,
                }
            }
        )
        return {
            "hive_id": row.hive_id,
            "files_json": row.files_json,
            "file_count": row.file_count,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    except Exception as exc:
        logger.debug(f"[DB] upsert_session_workspace failed: {exc}")
        return {"hive_id": hive_id, "files_json": files_json, "file_count": file_count}
