"""
AgentHive Engine - FastAPI Application (Phase 3)
Adds: WebSocket endpoint for live event streaming, event history replay,
and Redis connection on startup.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import config
from app.agents.factory import get_available_providers
from app.events import event_bus, HiveEvent
from app.executor import execute_session
from app.hive import execute_hive, resolve_review, _hive_killed
from app.dispatcher import run_business_analyst
from app.session import session_store
from app.tools.filesystem import FileSystemTool
from app.db import (
    db_list_hives, db_get_hive_detail, db_list_workspace_files, disconnect_db,
    db_get_system_settings, db_upsert_system_settings,
    db_get_session_workspace, db_upsert_session_workspace,
    db_get_qa_results, db_get_review_requests, db_get_token_summary,
)
from app.bucket import bucket_queue
from app.dispatcher import (
    start_factory, stop_factory, is_factory_running, get_active_factory_hive_id,
)


# ─── WebSocket Connection Manager ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        try:
            self.active.remove(ws)
        except ValueError:
            pass

    async def broadcast(self, data: dict) -> None:
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


ws_manager = ConnectionManager()


# ─── Background: bridge event_bus → WebSocket connections ─────────────────────
async def _event_bridge_task() -> None:
    """
    Subscribes to the global EventBus and forwards every event to all
    active WebSocket clients. Runs as a long-lived background task.
    """
    q = event_bus.subscribe()
    try:
        while True:
            event: HiveEvent = await q.get()
            if event is None:
                break
            await ws_manager.broadcast(event.to_dict())
    finally:
        event_bus.unsubscribe(q)


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"AgentHive Engine v0.5.0 — {config.ENGINE_HOST}:{config.ENGINE_PORT}")
    print(f"Workspace: {config.WORKSPACE_DIR}")

    # Try Redis
    await event_bus.connect_redis()

    # Load task bucket from DB (best-effort — no-ops if DB unavailable)
    await bucket_queue.load_from_db()

    # Start WS bridge
    bridge = asyncio.create_task(_event_bridge_task())

    yield

    bridge.cancel()
    try:
        await bridge
    except asyncio.CancelledError:
        pass
    await disconnect_db()
    print("AgentHive Engine shutting down")



# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AgentHive Engine",
    description="Model-Agnostic Multi-Agent Execution Engine",
    version="0.5.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.DASHBOARD_ORIGIN, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Schemas ──────────────────────────────────────────────────────────────────
class ExecuteRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    provider: str = Field(default="google")
    model: str | None = Field(default=None)
    session_id: str | None = Field(default=None)


class ExecuteResponse(BaseModel):
    session_id: str
    status: str
    message: str
    provider: str
    model: str


class HiveExecuteRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    provider: str = Field(default="google")
    model: str | None = Field(default=None)
    budget_limit: float = Field(default=2.0, ge=0.01, le=50.0,
                                description="Max spend in USD before session auto-kills")
    require_review: bool = Field(default=False,
                                 description="Pause before final deployment for human approval")
    run_qa: bool = Field(default=True, description="Run QA gate after workers complete")


class HiveExecuteResponse(BaseModel):
    hive_id: str
    status: str
    message: str
    provider: str
    model: str
    budget_limit: float


class AnalyzeRequest(BaseModel):
    requirement: str = Field(..., min_length=1, max_length=8000,
                             description="Raw business requirement to decompose into tasks")
    provider: str = Field(default="google")
    model: str | None = Field(default=None)
    budget_limit: float = Field(default=2.0, ge=0.01, le=50.0)
    run_qa: bool = Field(default=False)
    hive_id: str | None = Field(default=None,
                                description="Reuse an existing hive session (keeps graph alive)")


class AnalyzeResponse(BaseModel):
    hive_id: str
    status: str
    message: str
    tasks_queued: int


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "healthy",
        "engine": "AgentHive",
        "version": "0.5.0",
        "workspace": str(config.WORKSPACE_DIR),
        "redis": event_bus._redis_ok,
        "ws_clients": len(ws_manager.active),
    }


# ─── Providers ────────────────────────────────────────────────────────────────
@app.get("/providers", tags=["System"])
async def list_providers():
    return {"providers": get_available_providers()}


# ═══════════════════════════════════════════════════════════════════════════════
#  WEBSOCKET — live event stream
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws")
async def websocket_global(ws: WebSocket):
    """
    Global WebSocket: broadcasts ALL hive events in real-time.
    On connect, replays recent history for any active hive sessions.
    """
    await ws_manager.connect(ws)
    try:
        # Replay history for all active hive sessions
        history = event_bus.get_all_history()
        for hive_id, events in history.items():
            for ev in events:
                await ws.send_json(ev.to_dict())

        # Keep connection alive; the bridge task handles actual broadcast
        while True:
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
                # Handle ping from client
                if data == "ping":
                    await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Send keepalive
                await ws.send_json({"type": "keepalive"})
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(ws)


@app.websocket("/ws/hive/{hive_id}")
async def websocket_hive(ws: WebSocket, hive_id: str):
    """
    Hive-scoped WebSocket: sends only events for the specified hive.
    On connect, replays the full event history for that hive.
    """
    await ws_manager.connect(ws)

    # Register a filtered queue for this hive
    q = event_bus.subscribe()

    async def _sender():
        # Clean client state prior to replay
        await ws.send_json({"type": "clear"})
        # Replay history
        for ev in event_bus.get_history(hive_id):
            await ws.send_json(ev.to_dict())
        # Stream live
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30.0)
                if event is None:
                    break
                if event.hive_id == hive_id:
                    await ws.send_json(event.to_dict())
            except asyncio.TimeoutError:
                await ws.send_json({"type": "keepalive"})
            except Exception:
                break

    async def _receiver():
        while True:
            try:
                data = await ws.receive_text()
                if data == "ping":
                    await ws.send_json({"type": "pong"})
            except WebSocketDisconnect:
                break
            except Exception:
                break

    try:
        sender_task = asyncio.create_task(_sender())
        receiver_task = asyncio.create_task(_receiver())
        done, pending = await asyncio.wait(
            [sender_task, receiver_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    except Exception:
        pass
    finally:
        event_bus.unsubscribe(q)
        ws_manager.disconnect(ws)


# ─── Event History REST endpoint ──────────────────────────────────────────────
@app.get("/hive/{hive_id}/events", tags=["Hive"])
async def get_hive_events(hive_id: str, limit: int = 500):
    """Return the full event history for a Hive (for history replay on page load)."""
    events = event_bus.get_history(hive_id)
    return {
        "hive_id": hive_id,
        "count": len(events),
        "events": [e.to_dict() for e in events[-limit:]],
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 1 - Legacy single-agent endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/execute", response_model=ExecuteResponse, tags=["Agent (Legacy)"])
async def execute(req: ExecuteRequest, background_tasks: BackgroundTasks):
    from app import config as cfg
    model = req.model or cfg.DEFAULT_MODELS.get(req.provider.lower(), "")
    session = session_store.create(provider=req.provider.lower(), model=model, prompt=req.prompt)
    background_tasks.add_task(execute_session, session)
    return ExecuteResponse(
        session_id=session.id, status="started",
        message=f"Agent session started with {req.provider}",
        provider=session.provider, model=session.model,
    )


@app.get("/sessions/{session_id}/stream", tags=["Agent (Legacy)"])
async def stream_session_logs(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    async def _gen():
        for log in session.logs:
            yield {"event": "log", "data": json.dumps({
                "id": log.id, "sessionId": log.session_id, "agentId": log.agent_id,
                "timestamp": log.timestamp, "level": log.level, "message": log.message,
            })}
        if session.status in ("idle", "running"):
            async for log in session.stream_logs():
                yield {"event": "log", "data": json.dumps({
                    "id": log.id, "sessionId": log.session_id, "agentId": log.agent_id,
                    "timestamp": log.timestamp, "level": log.level, "message": log.message,
                })}
        yield {"event": "done", "data": json.dumps({"status": session.status, "sessionId": session_id})}

    return EventSourceResponse(_gen())


@app.get("/sessions", tags=["Sessions"])
async def list_sessions():
    return {"sessions": [
        {"id": s.id, "provider": s.provider, "model": s.model, "status": s.status,
         "created_at": s.created_at, "completed_at": s.completed_at,
         "log_count": len(s.logs), "prompt_preview": s.prompt[:100]}
        for s in session_store.all()
    ]}


@app.get("/sessions/{session_id}", tags=["Sessions"])
async def get_session(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": session.id, "provider": session.provider, "model": session.model,
        "status": session.status, "prompt": session.prompt,
        "created_at": session.created_at, "completed_at": session.completed_at,
        "logs": [{"id": l.id, "timestamp": l.timestamp, "level": l.level, "message": l.message}
                 for l in session.logs],
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 2+3 — Hive endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/hive/execute", response_model=HiveExecuteResponse, tags=["Hive"])
async def hive_execute(req: HiveExecuteRequest, background_tasks: BackgroundTasks):
    from app import config as cfg
    model = req.model or cfg.DEFAULT_MODELS.get(req.provider.lower(), "")
    hive = session_store.create_hive(provider=req.provider.lower(), model=model, prompt=req.prompt)
    background_tasks.add_task(
        execute_hive, hive,
        budget_limit=req.budget_limit,
        require_review=req.require_review,
        run_qa=req.run_qa,
    )
    return HiveExecuteResponse(
        hive_id=hive.id, status="started",
        message="Hive session started — Manager Agent will orchestrate Workers.",
        provider=hive.provider, model=hive.model,
        budget_limit=req.budget_limit,
    )

@app.post("/hive/analyze", tags=["Hive"])
async def hive_analyze(req: AnalyzeRequest, background_tasks: BackgroundTasks):
    """
    Spawn a Business Analyst agent that decomposes a business requirement into
    granular tasks and enqueues them to the Kanban bucket queue.

    The BA agent runs in the background; tasks appear on the board in real-time.
    The caller receives the hive_id immediately so the dashboard can subscribe
    to the WebSocket and watch the BA thinking live.
    """
    from app import config as cfg
    model = req.model or cfg.DEFAULT_MODELS.get(req.provider.lower(), "")

    # Reuse existing hive or create a fresh one
    if req.hive_id:
        hive = session_store.get_hive(req.hive_id)
        if hive is None:
            hive = session_store.create_hive(
                provider=req.provider.lower(),
                model=model,
                prompt=f"[BA] {req.requirement[:120]}",
                hive_id=req.hive_id,
            )
    else:
        hive = session_store.create_hive(
            provider=req.provider.lower(),
            model=model,
            prompt=f"[BA] {req.requirement[:120]}",
        )

    background_tasks.add_task(
        run_business_analyst,
        requirement=req.requirement,
        hive=hive,
        provider=req.provider.lower(),
        model=model,
        budget_limit=req.budget_limit,
        run_qa=req.run_qa,
    )

    return AnalyzeResponse(
        hive_id=hive.id,
        status="analyzing",
        message="Business Analyst agent is decomposing your requirement into tasks. Watch the Kanban board.",
        tasks_queued=0,  # Tasks are created async — poll /bucket/tasks for updates
    )


@app.get("/hive/{hive_id}/stream", tags=["Hive"])
async def stream_hive_logs(hive_id: str):
    hive = session_store.get_hive(hive_id)
    if not hive:
        raise HTTPException(status_code=404, detail=f"Hive {hive_id} not found")

    async def _gen():
        for log in hive.logs:
            yield {"event": "log", "data": json.dumps({
                "id": log.id, "hiveId": log.session_id, "agentId": log.agent_id,
                "timestamp": log.timestamp, "level": log.level, "message": log.message,
            })}
        yield {"event": "agent_tree", "data": json.dumps({"agents": hive.get_tree()})}

        if hive.status in ("idle", "running"):
            seen_statuses: dict[str, str] = {}
            tick = 0
            async for log in hive.stream_logs():
                yield {"event": "log", "data": json.dumps({
                    "id": log.id, "hiveId": log.session_id, "agentId": log.agent_id,
                    "timestamp": log.timestamp, "level": log.level, "message": log.message,
                })}
                tick += 1
                if tick % 3 == 0:
                    cur = {nid: n.status for nid, n in hive.agents.items()}
                    if cur != seen_statuses:
                        seen_statuses = dict(cur)
                        yield {"event": "agent_tree", "data": json.dumps({"agents": hive.get_tree()})}

        yield {"event": "agent_tree", "data": json.dumps({"agents": hive.get_tree()})}
        yield {"event": "done", "data": json.dumps({"status": hive.status, "hiveId": hive_id})}

    return EventSourceResponse(_gen())


@app.get("/hive/{hive_id}", tags=["Hive"])
async def get_hive_detail_endpoint(hive_id: str):
    """Unified hive detail: checks in-memory first, then falls back to PostgreSQL."""
    hive = session_store.get_hive(hive_id)
    if hive:
        agents = hive.get_tree()
        return {
            "id": hive_id,
            "prompt": hive.prompt,
            "provider": hive.provider,
            "model": hive.model,
            "status": hive.status,
            "budget_limit": hive.budget_limit,
            "created_at": str(hive.created_at),
            "completed_at": str(hive.completed_at) if hive.completed_at else None,
            "agents": agents,
            "log_count": len(hive.logs),
        }
    # Fall back to DB for historical sessions
    data = await db_get_hive_detail(hive_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Hive {hive_id} not found")
    return data


@app.get("/hive/{hive_id}/agents", tags=["Hive"])
async def get_hive_agents(hive_id: str):
    hive = session_store.get_hive(hive_id)
    if hive:
        return {"hive_id": hive_id, "status": hive.status, "agents": hive.get_tree()}
    # Fall back to DB
    data = await db_get_hive_detail(hive_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Hive {hive_id} not found")
    return {"hive_id": hive_id, "status": data.get("status", "unknown"), "agents": data.get("agents", [])}


@app.get("/hive/{hive_id}/bus", tags=["Hive"])
async def get_hive_bus(hive_id: str):
    hive = session_store.get_hive(hive_id)
    if not hive:
        raise HTTPException(status_code=404, detail=f"Hive {hive_id} not found")
    return {"hive_id": hive_id, "topics": hive.message_bus.get_all()}


@app.get("/hive", tags=["Hive"])
async def list_hive_sessions():
    """Return live in-memory sessions + DB-persisted history, merged and deduplicated."""
    live_hives = {
        h.id: {
            "id": h.id, "provider": h.provider, "model": h.model, "status": h.status,
            "created_at": str(h.created_at), "completed_at": str(h.completed_at) if h.completed_at else None,
            "agent_count": len(h.agents), "log_count": len(h.logs),
            "prompt_preview": h.prompt[:100],
        }
        for h in session_store.all_hive()
    }
    # Merge with DB records (DB may have older sessions not in memory)
    db_rows = await db_list_hives(50)
    for row in db_rows:
        rid = row.get("id")
        if rid and rid not in live_hives:
            live_hives[rid] = {
                "id": rid,
                "provider": row.get("provider", ""),
                "model": row.get("model", ""),
                "status": row.get("status", "unknown"),
                "created_at": str(row.get("created_at", "")),
                "completed_at": str(row.get("completed_at", "")) if row.get("completed_at") else None,
                "agent_count": len(row.get("agents", [])),
                "log_count": len(row.get("logs", [])),
                "prompt_preview": row.get("prompt", "")[:100],
            }
    # Sort by created_at descending
    sorted_hives = sorted(live_hives.values(), key=lambda h: h.get("created_at", ""), reverse=True)
    return {"hives": sorted_hives}


# ─── Workspace ────────────────────────────────────────────────────────────────
@app.get("/workspace", tags=["Workspace"])
async def get_workspace():
    fs = FileSystemTool(session_dir=config.WORKSPACE_DIR)
    return fs.read_dir(".")


@app.get("/workspace/file", tags=["Workspace"])
async def read_workspace_file(path: str, hive_id: str | None = None):
    from fastapi.responses import PlainTextResponse
    # If a hive_id is provided, scope the read to that session's directory
    if hive_id:
        session_dir = None
        for prefix in ("hive", "session"):
            d = config.WORKSPACE_DIR / f"{prefix}-{hive_id[:8]}"
            if d.exists():
                session_dir = d
                break
        if session_dir is None:
            raise HTTPException(status_code=404, detail="Session workspace not found")
        fs = FileSystemTool(session_dir=session_dir)
    else:
        fs = FileSystemTool(session_dir=config.WORKSPACE_DIR)
    result = fs.read_file(path)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Error reading file"))
    return PlainTextResponse(result.get("content", ""))


@app.get("/workspace/{session_id}", tags=["Workspace"])
async def get_session_workspace(session_id: str):
    for prefix in ("hive", "session"):
        d = config.WORKSPACE_DIR / f"{prefix}-{session_id[:8]}"
        if d.exists():
            return FileSystemTool(session_dir=d).read_dir(".")
    raise HTTPException(status_code=404, detail="Session workspace not found")


@app.get("/hive/{hive_id}/files", tags=["Workspace"])
async def get_hive_files(hive_id: str):
    """
    Return workspace file metadata for a hive session.
    Primary source: PostgreSQL workspace_files table (persisted on every agent write).
    Fallback: live disk scan of the session directory if no DB records exist.
    """
    # Try DB first
    db_files = await db_list_workspace_files(hive_id)
    if db_files:
        return {"hive_id": hive_id, "source": "db", "files": db_files, "count": len(db_files)}

    # Fallback: scan disk
    session_dir = None
    for prefix in ("hive", "session"):
        d = config.WORKSPACE_DIR / f"{prefix}-{hive_id[:8]}"
        if d.exists():
            session_dir = d
            break


    if session_dir is None:
        return {"hive_id": hive_id, "source": "none", "files": [], "count": 0}

    # ── Recursive disk scan ──────────────────────────────────────────────────
    def _scan_recursive(base: Path, rel_root: str = "") -> list[dict]:
        results: list[dict] = []
        try:
            for entry in sorted(base.iterdir(), key=lambda p: (p.is_file(), p.name)):
                rel = f"{rel_root}/{entry.name}".lstrip("/")
                if entry.is_dir():
                    results.append({
                        "path":         rel,
                        "size_bytes":   0,
                        "mime_type":    "inode/directory",
                        "is_directory": True,
                        "agent_id":     None,
                        "updated_at":   None,
                    })
                    results.extend(_scan_recursive(entry, rel))
                else:
                    results.append({
                        "path":         rel,
                        "size_bytes":   entry.stat().st_size,
                        "mime_type":    "text/plain",
                        "is_directory": False,
                        "agent_id":     None,
                        "updated_at":   None,
                    })
        except PermissionError:
            pass
        return results

    files = _scan_recursive(session_dir)
    return {"hive_id": hive_id, "source": "disk", "files": files, "count": len(files)}


# ── Workspace Snapshot (persist full FileNode tree as JSON blob) ──────────────

class WorkspaceSnapshotSave(BaseModel):
    files_json: str = Field(..., description="Full FileNode[] tree serialised as JSON string")


@app.get("/workspace/{hive_id}/snapshot", tags=["Workspace"])
async def get_workspace_snapshot(hive_id: str):
    """Return the persisted workspace file-tree snapshot for a hive session."""
    snap = await db_get_session_workspace(hive_id)
    if snap:
        return {
            "hive_id":    hive_id,
            "files_json": snap["files_json"],
            "file_count": snap["file_count"],
            "updated_at": snap["updated_at"],
            "source":     "db",
        }
    return {
        "hive_id":    hive_id,
        "files_json": "[]",
        "file_count": 0,
        "updated_at": None,
        "source":     "none",
    }


@app.post("/workspace/{hive_id}/snapshot", tags=["Workspace"])
async def save_workspace_snapshot(hive_id: str, body: WorkspaceSnapshotSave):
    """Persist the full workspace file-tree snapshot (as a JSON string) for a hive session."""
    try:
        import json as _json
        nodes = _json.loads(body.files_json)
        file_count = _count_files(nodes) if isinstance(nodes, list) else 0
    except Exception:
        file_count = 0

    await db_upsert_session_workspace(hive_id, body.files_json, file_count)
    return {"hive_id": hive_id, "saved": True, "file_count": file_count}


def _count_files(nodes: list) -> int:
    """Recursively count non-directory FileNode entries."""
    total = 0
    for n in nodes:
        if isinstance(n, dict):
            if n.get("type") != "directory":
                total += 1
            if n.get("children"):
                total += _count_files(n["children"])
    return total


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 5 — Self-Healing Controls, QA, Budget, Human-in-the-loop
# ═══════════════════════════════════════════════════════════════════════════════

class ReviewDecisionRequest(BaseModel):
    approved: bool


@app.post("/hive/{hive_id}/review", tags=["Hive"])
async def resolve_review_request(hive_id: str, body: ReviewDecisionRequest):
    """Approve or reject a pending human-in-the-loop review for a Hive session."""
    ok = resolve_review(hive_id, body.approved)
    if not ok:
        raise HTTPException(status_code=404, detail="No pending review for this hive")
    return {"hive_id": hive_id, "approved": body.approved, "resolved": True}


@app.post("/hive/{hive_id}/kill", tags=["Hive"])
async def kill_hive_session(hive_id: str):
    """Manually force-kill a running hive session (budget guardrail)."""
    hive = session_store.get_hive(hive_id)
    if not hive:
        raise HTTPException(status_code=404, detail=f"Hive {hive_id} not found")
    _hive_killed[hive_id] = True
    hive.add_log("error", "Session manually killed by user.", agent_id="system")
    return {"hive_id": hive_id, "killed": True}


@app.get("/hive/{hive_id}/cost", tags=["Hive"])
async def get_hive_cost(hive_id: str):
    """Return current cost estimate and token usage for a hive session."""
    from app.hive import _hive_char_counters, _COST_PER_1K
    hive = session_store.get_hive(hive_id)
    if not hive:
        raise HTTPException(status_code=404, detail=f"Hive {hive_id} not found")
    chars = _hive_char_counters.get(hive_id, 0)
    rate  = _COST_PER_1K.get(hive.provider, 0.003)
    tokens = chars // 4
    cost   = (tokens / 1000) * rate
    return {
        "hive_id": hive_id,
        "provider": hive.provider,
        "estimated_tokens": tokens,
        "estimated_cost_usd": round(cost, 6),
        "is_killed": _hive_killed.get(hive_id, False),
    }


@app.get("/hive/{hive_id}/db", tags=["Hive"])
async def get_hive_from_db(hive_id: str):
    """Retrieve persisted hive data from PostgreSQL (for page-reload restoration)."""
    data = await db_get_hive_detail(hive_id)
    if not data:
        raise HTTPException(status_code=404, detail="Hive not found in DB (may not be persisted)")
    return data


@app.get("/hive-history", tags=["Hive"])
async def list_hives_from_db(limit: int = 20):
    """List recent hive sessions from PostgreSQL for full persistence restore."""
    rows = await db_list_hives(limit)
    return {"hives": rows, "count": len(rows)}


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 5 — Task Bucket API
# ═══════════════════════════════════════════════════════════════════════════════

class TaskCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=4000)
    priority: str = Field(default="MEDIUM", pattern="^(LOW|MEDIUM|HIGH)$")


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    priority: str | None = Field(default=None, pattern="^(LOW|MEDIUM|HIGH)$")


class BucketStartRequest(BaseModel):
    provider: str = Field(default="google")
    model: str | None = Field(default=None)
    budget_limit: float = Field(default=2.0, ge=0.01, le=50.0)
    run_qa: bool = Field(default=False)          # off by default — saves time
    stop_on_failure: bool = Field(default=False)
    hive_id: str | None = Field(default=None)    # reuse existing orchestration session


@app.post("/bucket/tasks", tags=["Bucket"])
async def create_bucket_task(req: TaskCreateRequest):
    """Add a new task to the persistent bucket."""
    task = await bucket_queue.enqueue(
        title=req.title,
        description=req.description,
        priority=req.priority,
    )
    return task.to_dict()


@app.get("/bucket/tasks", tags=["Bucket"])
async def list_bucket_tasks(status: str | None = None):
    """List all tasks in the bucket, optionally filtered by status."""
    tasks = bucket_queue.all_tasks()
    if status:
        tasks = [t for t in tasks if t.status.lower() == status.lower()]
    # Sort: PENDING (priority), then IN_PROGRESS, then COMPLETED, then FAILED
    status_order = {"PENDING": 0, "IN_PROGRESS": 1, "COMPLETED": 2, "FAILED": 3, "CANCELLED": 4}
    tasks.sort(key=lambda t: (status_order.get(t.status, 5), t._sort_key))
    return {"tasks": [t.to_dict() for t in tasks], "count": len(tasks)}


@app.put("/bucket/tasks/{task_id}", tags=["Bucket"])
async def update_bucket_task(task_id: str, req: TaskUpdateRequest):
    """Update task title, description, or priority (only PENDING tasks)."""
    task = await bucket_queue.update(
        task_id,
        title=req.title,
        description=req.description,
        priority=req.priority,
    )
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task.to_dict()


@app.delete("/bucket/tasks/{task_id}", tags=["Bucket"])
async def delete_bucket_task(task_id: str):
    """Delete a task (only if PENDING or FAILED)."""
    ok = await bucket_queue.delete(task_id)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Task not found or is currently IN_PROGRESS (cannot delete active tasks)"
        )
    return {"deleted": True, "task_id": task_id}


@app.get("/bucket/progress", tags=["Bucket"])
async def get_bucket_progress():
    """Return live queue stats: pending/in_progress/completed/failed counts and %."""
    progress = bucket_queue.get_progress()
    active_hive = get_active_factory_hive_id()
    return {
        **progress,
        "factory_running": active_hive is not None,
        "factory_hive_id": active_hive,
    }


@app.get("/bucket/progress/stream", tags=["Bucket"])
async def stream_bucket_progress():
    """SSE stream that pushes progress updates whenever queue state changes."""
    import asyncio as _asyncio
    queue: _asyncio.Queue = _asyncio.Queue(maxsize=50)

    def _on_change(tasks):
        progress = bucket_queue.get_progress()
        active_hive = get_active_factory_hive_id()
        data = {
            **progress,
            "factory_running": active_hive is not None,
            "factory_hive_id": active_hive,
            "tasks": [t.to_dict() for t in tasks],
        }
        try:
            queue.put_nowait(data)
        except _asyncio.QueueFull:
            pass

    bucket_queue.subscribe(_on_change)

    async def _gen():
        # Emit initial state
        progress = bucket_queue.get_progress()
        active_hive = get_active_factory_hive_id()
        yield {
            "event": "progress",
            "data": json.dumps({
                **progress,
                "factory_running": active_hive is not None,
                "factory_hive_id": active_hive,
                "tasks": [t.to_dict() for t in bucket_queue.all_tasks()],
            }),
        }
        try:
            while True:
                try:
                    data = await _asyncio.wait_for(queue.get(), timeout=20.0)
                    yield {"event": "progress", "data": json.dumps(data)}
                except _asyncio.TimeoutError:
                    yield {"event": "keepalive", "data": "{}"}
        finally:
            bucket_queue.unsubscribe(_on_change)

    return EventSourceResponse(_gen())


@app.post("/bucket/start", tags=["Bucket"])
async def start_bucket_factory(req: BucketStartRequest):
    """
    Start the autonomous factory loop — Manager Agent drains the task queue
    sequentially, with context stitching between tasks.
    """
    from app import config as cfg
    model = req.model or cfg.DEFAULT_MODELS.get(req.provider.lower(), "")

    # Only allow one factory at a time
    active_hive = get_active_factory_hive_id()
    if active_hive:
        return {
            "status": "already_running",
            "hive_id": active_hive,
            "message": "Factory is already running. Stop it first with DELETE /bucket/factory.",
        }

    pending = bucket_queue.get_progress()["pending"]
    if pending == 0:
        return {
            "status": "empty",
            "hive_id": None,
            "message": "No pending tasks in bucket. Add tasks first.",
        }

    hive = await start_factory(
        provider=req.provider.lower(),
        model=model,
        budget_limit=req.budget_limit,
        run_qa=req.run_qa,
        stop_on_failure=req.stop_on_failure,
        existing_hive_id=req.hive_id or None,
    )
    return {
        "status": "started",
        "hive_id": hive.id,
        "message": f"Factory started — dispatching {pending} task(s) to agents.",
        "provider": hive.provider,
        "model": hive.model,
        "budget_limit": req.budget_limit,
    }


@app.delete("/bucket/factory", tags=["Bucket"])
async def stop_bucket_factory():
    """Stop the running factory loop gracefully."""
    active_hive = get_active_factory_hive_id()
    if not active_hive:
        raise HTTPException(status_code=404, detail="No factory is currently running")
    ok = stop_factory(active_hive)
    return {"stopped": ok, "hive_id": active_hive}


@app.get("/bucket/factory/status", tags=["Bucket"])
async def get_factory_status():
    """Return factory running state + current progress."""
    active_hive = get_active_factory_hive_id()
    progress = bucket_queue.get_progress()
    return {
        "running": active_hive is not None,
        "hive_id": active_hive,
        **progress,
    }




# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 5 — System Settings (Persisted in Postgres)
# ═══════════════════════════════════════════════════════════════════════════════

class SystemSettingsUpdate(BaseModel):
    provider: str | None = None
    model: str | None = None
    google_key: str | None = None
    openai_key: str | None = None
    anthropic_key: str | None = None
    deepseek_key: str | None = None
    budget_limit: float | None = None
    run_qa: bool | None = None
    require_review: bool | None = None


@app.get("/settings", tags=["Settings"])
async def get_system_settings():
    """Retrieve global platform configurations from Postgres."""
    settings = await db_get_system_settings()
    
    # Redact keys for frontend transmission to avoid leaking them
    def redact(key_val):
        if not key_val:
            return ""
        if len(key_val) > 8:
            return key_val[:4] + "*" * (len(key_val) - 8) + key_val[-4:]
        return "***"
    
    frontend_settings = dict(settings)
    # Provide masked versions to client if they exist, to indicate they are set
    frontend_settings["google_key_set"] = bool(settings.get("google_key"))
    frontend_settings["openai_key_set"] = bool(settings.get("openai_key"))
    frontend_settings["anthropic_key_set"] = bool(settings.get("anthropic_key"))
    frontend_settings["deepseek_key_set"] = bool(settings.get("deepseek_key"))
    
    # Overwrite actual plaintext keys in response
    frontend_settings["google_key"] = ""
    frontend_settings["openai_key"] = ""
    frontend_settings["anthropic_key"] = ""
    frontend_settings["deepseek_key"] = ""

    return frontend_settings


@app.post("/settings", tags=["Settings"])
async def update_system_settings(data: SystemSettingsUpdate):
    """Upsert global platform configurations in Postgres."""
    update_data = {k: v for k, v in data.dict().items() if v is not None}
    
    # Don't update keys if they are passed as empty or mask strings
    for k in ["google_key", "openai_key", "anthropic_key", "deepseek_key"]:
        if k in update_data and (not update_data[k] or "*" in update_data[k]):
            del update_data[k]
            
    updated = await db_upsert_system_settings(update_data)
    
    # Update running config.py state so it takes effect immediately for new agents
    if "google_key" in update_data:
        config.GOOGLE_API_KEY = update_data["google_key"]
    if "openai_key" in update_data:
        config.OPENAI_API_KEY = update_data["openai_key"]
    if "anthropic_key" in update_data:
        config.ANTHROPIC_API_KEY = update_data["anthropic_key"]
    if "deepseek_key" in update_data:
        config.DEEPSEEK_API_KEY = update_data["deepseek_key"]
        
    return {"status": "ok", "message": "Settings updated safely"}


# ═══════════════════════════════════════════════════════════════════════════════
#  Workspace Snapshot  –  JSON blob per session
# ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceSnapshotRequest(BaseModel):
    files_json: str = Field(default="[]", description="JSON-encoded FileNode[] tree")


@app.get("/workspace/{hive_id}/snapshot", tags=["Workspace"])
async def get_workspace_snapshot(hive_id: str):
    """
    Fetch the latest workspace file tree snapshot for a session.
    Returns the entire FileNode[] tree as a JSON string (plus metadata).
    """
    row = await db_get_session_workspace(hive_id)
    if not row:
        return {"hive_id": hive_id, "files_json": "[]", "file_count": 0, "source": "none"}
    return {**row, "source": "db"}


@app.post("/workspace/{hive_id}/snapshot", tags=["Workspace"])
async def upsert_workspace_snapshot(hive_id: str, body: WorkspaceSnapshotRequest):
    """
    Upsert the workspace file tree snapshot for a session.
    Expects the full FileNode[] tree serialised as a JSON string.
    """
    try:
        parsed = json.loads(body.files_json)
        file_count = _count_files(parsed)
    except Exception:
        raise HTTPException(status_code=400, detail="files_json must be valid JSON")

    row = await db_upsert_session_workspace(
        hive_id=hive_id,
        files_json=body.files_json,
        file_count=file_count,
    )
    return {"status": "ok", **row}


def _count_files(nodes: list, count: int = 0) -> int:
    """Recursively count file (non-directory) nodes in the tree."""
    for n in nodes:
        if isinstance(n, dict):
            if n.get("type") != "directory":
                count += 1
            if n.get("children"):
                count = _count_files(n["children"], count)
    return count


# ═══════════════════════════════════════════════════════════════════════════════
#  Session Analytics Endpoints  –  QA / Reviews / Token Usage
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/hive/{hive_id}/qa-results", tags=["Analytics"])
async def get_qa_results(hive_id: str):
    """Return all QA test results for a hive session."""
    results = await db_get_qa_results(hive_id)
    return {"hive_id": hive_id, "results": results, "count": len(results)}


@app.get("/hive/{hive_id}/review-requests", tags=["Analytics"])
async def get_review_requests_endpoint(hive_id: str):
    """Return all human-review requests for a hive session."""
    requests = await db_get_review_requests(hive_id)
    return {"hive_id": hive_id, "requests": requests, "count": len(requests)}


@app.get("/hive/{hive_id}/token-usage", tags=["Analytics"])
async def get_token_usage(hive_id: str):
    """Return aggregated token and cost stats for a hive session."""
    summary = await db_get_token_summary(hive_id)
    return {"hive_id": hive_id, **summary}
