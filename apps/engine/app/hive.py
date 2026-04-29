"""
AgentHive Engine - Hive Orchestrator (Phase 5)
Supervisor-Worker pattern with full event bus integration.
New in Phase 5:
  - Self-healing loop: auto-fix shell errors via LLM re-prompt
  - QA Agent gate: mandatory tests before DONE
  - Budget guardrails: kill session if cost > limit
  - PostgreSQL persistence via Prisma
  - Human-in-the-loop review requests
"""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable

from app import config
from app.agents.factory import create_agent
from app.agents.prompts import MANAGER_SYSTEM_PROMPT, get_system_prompt
from app.dialogue import build_spawn_delegation_message
from app.events import emit_event, event_bus, HiveEvent
from app.session import AgentNode, HiveSession, MessageBus
from app.tools.filesystem import FileSystemTool
from app.tools.terminal import TerminalTool
from app.self_healer import (
    is_error_output,
    attempt_self_heal,
    MAX_HEAL_ATTEMPTS,
)
from app.db import (
    db_upsert_hive,
    db_upsert_agent,
    db_append_log,
    db_save_token_usage,
    db_get_hive_cost,
    db_save_workspace_file,
    db_save_qa_result,
    db_save_review_request,
    db_resolve_review_request,
)

# ─── Budget constants ─────────────────────────────────────────────────────────
# Approximate costs per 1k tokens (USD)
_COST_PER_1K: dict[str, float] = {
    "google": 0.00025,
    "openai": 0.005,
    "anthropic": 0.003,
}
_DEFAULT_BUDGET_LIMIT: float = float(config.__dict__.get("BUDGET_LIMIT", 2.0))

# Per-hive in-memory token counters {hive_id: total_chars}
_hive_char_counters: dict[str, int] = {}

# Per-hive killed flag
_hive_killed: dict[str, bool] = {}

# Per-hive review request Events {hive_id: asyncio.Event}
_hive_review_events: dict[str, asyncio.Event] = {}
_hive_review_approved: dict[str, bool] = {}


# ─── Action Parser ────────────────────────────────────────────────────────────
_ACTION_PATTERN = re.compile(
    r"```(?:action|json)?\s*(\{.*?\})\s*```",
    re.DOTALL | re.IGNORECASE,
)


def _extract_actions(text: str) -> list[dict]:
    actions = []
    for match in _ACTION_PATTERN.finditer(text):
        try:
            obj = json.loads(match.group(1))
            if isinstance(obj, dict) and "action" in obj:
                actions.append(obj)
        except json.JSONDecodeError:
            pass
    return actions


# ─── Instrumented FileSystemTool wrapper ──────────────────────────────────────
class EventedFileSystemTool(FileSystemTool):
    """FileSystemTool that emits FILE_CHANGE events on writes."""

    def __init__(self, session_dir: Path, log_emitter, hive_id: str, agent_id: str, role: str = ""):
        super().__init__(session_dir=session_dir, log_emitter=log_emitter)
        self._hive_id = hive_id
        self._agent_id = agent_id
        self._role = role

    def write_file(self, relative_path: str, content: str) -> dict:
        result = super().write_file(relative_path, content)
        if result.get("success"):
            size = result.get("bytes_written", len(content.encode()))
            # Determine mime type from extension
            ext = relative_path.rsplit(".", 1)[-1].lower() if "." in relative_path else ""
            mime = {
                "py": "text/x-python", "ts": "application/typescript",
                "tsx": "application/typescript", "js": "application/javascript",
                "jsx": "application/javascript", "json": "application/json",
                "html": "text/html", "css": "text/css",
                "md": "text/markdown", "txt": "text/plain",
                "sh": "application/x-sh", "yml": "application/x-yaml",
                "yaml": "application/x-yaml", "toml": "application/toml",
                "sql": "application/sql",
            }.get(ext, "text/plain")
            emit_event(
                "FILE_CHANGE",
                hive_id=self._hive_id,
                agent_id=self._agent_id,
                data={"path": relative_path, "size": size, "op": "modified"},
                role=self._role,
            )
            # Fire-and-forget: persist file metadata to DB
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(db_save_workspace_file(
                    hive_id=self._hive_id,
                    agent_id=self._agent_id,
                    path=relative_path,
                    size_bytes=size,
                    mime_type=mime,
                    is_directory=False,
                ))
            except RuntimeError:
                pass  # no running loop — skip DB save
        return result

    def mkdir(self, relative_path: str) -> dict:
        result = super().mkdir(relative_path)
        emit_event(
            "FILE_CHANGE",
            hive_id=self._hive_id,
            agent_id=self._agent_id,
            data={"path": relative_path, "op": "created"},
            role=self._role,
        )
        # Persist directory metadata too
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(db_save_workspace_file(
                hive_id=self._hive_id,
                agent_id=self._agent_id,
                path=relative_path,
                size_bytes=0,
                mime_type="inode/directory",
                is_directory=True,
            ))
        except RuntimeError:
            pass
        return result


# ─── Instrumented TerminalTool wrapper ────────────────────────────────────────
class EventedTerminalTool(TerminalTool):
    """TerminalTool that emits SHELL_OUTPUT events per stdout line.
    Phase 5: also accumulates raw output for self-healing error detection.
    """

    def __init__(self, session_dir: Path, log_emitter, hive_id: str, agent_id: str, role: str = ""):
        super().__init__(session_dir=session_dir, log_emitter=log_emitter)
        self._hive_id = hive_id
        self._agent_id = agent_id
        self._role = role
        self.last_output: str = ""   # raw output of most recent command
        self.last_exit_code: int = 0

    def execute_command(self, command: str, cwd: str | None = None, timeout: int = 120, env: dict | None = None) -> dict:
        emit_event(
            "TOOL_CALL",
            hive_id=self._hive_id,
            agent_id=self._agent_id,
            data={"tool": "execute_command", "command": command, "cwd": cwd},
            role=self._role,
        )

        # Monkey-patch the log emitter to also emit SHELL_OUTPUT events
        original_log = self._log
        output_lines: list[str] = []

        def evented_log(level: str, message: str) -> None:
            original_log(level, message)
            output_lines.append(message)
            emit_event(
                "SHELL_OUTPUT",
                hive_id=self._hive_id,
                agent_id=self._agent_id,
                data={"line": message, "level": level},
                role=self._role,
            )

        self._log = evented_log
        result = super().execute_command(command, cwd, timeout, env)
        self._log = original_log

        # Store for self-healing
        self.last_output = "\n".join(output_lines)
        self.last_exit_code = result.get("exit_code", 0) if isinstance(result, dict) else 0
        return result


# ─── Budget Guardrail ─────────────────────────────────────────────────────────
def _estimate_cost(hive: HiveSession, chars: int) -> float:
    """Rough cost estimate from accumulated chars (4 chars ≈ 1 token)."""
    tokens = chars / 4
    rate = _COST_PER_1K.get(hive.provider, 0.003)
    return (tokens / 1000) * rate


def _accumulate_chars(hive_id: str, text: str) -> float:
    """Add chars to in-memory counter; return current total chars."""
    _hive_char_counters[hive_id] = _hive_char_counters.get(hive_id, 0) + len(text)
    return _hive_char_counters[hive_id]


async def _check_budget(
    hive: HiveSession,
    emit: Callable[[str, str], None],
    budget_limit: float = _DEFAULT_BUDGET_LIMIT,
) -> bool:
    """
    Returns True if hive is OVER budget (should be killed).
    Emits a WARNING_BUDGET event so the dashboard can show the alert.
    """
    chars = _hive_char_counters.get(hive.id, 0)
    estimated = _estimate_cost(hive, chars)
    # Also try to get persisted cost from DB
    db_cost = await db_get_hive_cost(hive.id)
    total_cost = max(estimated, db_cost)

    if total_cost >= budget_limit:
        _hive_killed[hive.id] = True
        emit("error", f"💸 BUDGET EXCEEDED: ${total_cost:.4f} >= limit ${budget_limit:.2f} — killing session!")
        emit_event(
            "ERROR",
            hive_id=hive.id,
            agent_id="system",
            data={
                "type": "BudgetExceeded",
                "cost": total_cost,
                "limit": budget_limit,
                "error": f"Session killed: cost ${total_cost:.4f} exceeded budget ${budget_limit:.2f}",
            },
        )
        return True
    return False


def _is_killed(hive_id: str) -> bool:
    return _hive_killed.get(hive_id, False)


# ─── QA Agent Runner ──────────────────────────────────────────────────────────
async def run_qa_agent(
    hive: HiveSession,
    session_dir: Path,
    parent_id: str,
    artifact_summary: str,
) -> bool:
    """
    Spawn a dedicated QA agent that:
    1. Writes a test script based on what was produced.
    2. Runs the tests.
    3. Returns True if all tests pass, False otherwise.
    """
    hive_id = hive.id
    qa_node = AgentNode(
        id=str(uuid.uuid4()),
        role="qa_engineer",
        session_id=hive_id,
        parent_id=parent_id,
        status="thinking",
        specialized_task="Run quality assurance and write automated tests for the delivered code.",
    )
    hive.register_agent(qa_node)

    emit_event(
        "SPAWN",
        hive_id=hive_id,
        agent_id=qa_node.id,
        parent_id=parent_id,
        data={"role": "qa_engineer", "task_preview": "QA Gate — writing and running tests"},
        role="qa_engineer",
    )
    emit_event("STATUS", hive_id, qa_node.id, {"status": "thinking", "role": "qa_engineer"}, role="qa_engineer")

    await db_upsert_agent(qa_node.id, hive_id, "qa_engineer", "thinking", parent_id, qa_node.specialized_task)

    def emit_qa(level: str, message: str) -> None:
        hive.add_log(level, f"[QA] {message}", agent_id=qa_node.id)

    # List files in workspace to give QA context
    fs = EventedFileSystemTool(session_dir, emit_qa, hive_id, qa_node.id, role="qa_engineer")
    tree_result = fs.read_dir(".")
    file_list = json.dumps(tree_result.get("entries", [])[:30], indent=2) if tree_result.get("success") else "[]"

    qa_prompt = f"""
## QA Gate — Your Mission
The team has delivered the following project. Your job is to write automated tests and verify correctness.

### Workspace files
```json
{file_list}
```

### What was built
{artifact_summary[:1000]}

### Instructions
1. Write a test script (e.g. `tests/test_main.py` or `tests/test_app.test.js`) that tests core functionality.
2. Run the tests using an appropriate test runner.
3. Report PASS or FAIL.

Output ONE write_file action for the test file, then ONE execute_command to run it.
Use format:
```action
{{"action": "write_file", "path": "tests/test_qa.py", "content": "...test code..."}}
```
```action
{{"action": "execute_command", "command": "python -m pytest tests/ -v --tb=short 2>&1 || true"}}
```

Begin.
""".strip()

    try:
        qa_agent = create_agent(provider=hive.provider, model=hive.model, log_emitter=emit_qa)
        qa_agent.SYSTEM_PROMPT = get_system_prompt("qa_engineer")  # type: ignore

        qa_node.status = "working"
        emit_event("STATUS", hive_id, qa_node.id, {"status": "working", "role": "qa_engineer"}, role="qa_engineer")

        response = await qa_agent.think(qa_prompt)
        _accumulate_chars(hive_id, response)

        actions = _extract_actions(response)
        terminal = EventedTerminalTool(session_dir, emit_qa, hive_id, qa_node.id, role="qa_engineer")
        passed = True

        for action in actions:
            atype = action.get("action", "").lower()
            if atype == "write_file":
                fs.write_file(action.get("path", "tests/test_qa.py"), action.get("content", ""))
            elif atype == "execute_command":
                result = await terminal.execute_async(
                    command=action.get("command", ""),
                    cwd=action.get("cwd"),
                    timeout=120,
                )
                # Check test result
                raw = terminal.last_output
                if is_error_output(raw, terminal.last_exit_code):
                    if "passed" not in raw.lower():
                        passed = False

        qa_node.status = "completed"
        qa_node.completed_at = datetime.utcnow().isoformat()
        emit_event("STATUS", hive_id, qa_node.id, {"status": "completed", "role": "qa_engineer"}, role="qa_engineer")
        emit_event("DONE", hive_id, qa_node.id, {"role": "qa_engineer", "qa_passed": passed}, role="qa_engineer")
        emit_qa("success" if passed else "warning", f"QA Gate: {'✅ PASSED' if passed else '⚠️ FAILED'}")
        await db_upsert_agent(qa_node.id, hive_id, "qa_engineer", "completed", parent_id, qa_node.specialized_task)
        # ── Persist QA result to database ─────────────────────────────────────
        await db_save_qa_result(
            hive_id=hive_id,
            agent_id=qa_node.id,
            test_file="tests/test_qa.py",
            passed=passed,
            output=terminal.last_output[:8000] if hasattr(terminal, "last_output") else "",
        )
        return passed

    except Exception as exc:
        qa_node.status = "error"
        emit_event("STATUS", hive_id, qa_node.id, {"status": "error", "role": "qa_engineer"}, role="qa_engineer")
        emit_event("ERROR", hive_id, qa_node.id, {"error": str(exc)}, role="qa_engineer")
        await db_upsert_agent(qa_node.id, hive_id, "qa_engineer", "error", parent_id, qa_node.specialized_task)
        return False


# ─── Human-in-the-loop Review Gate ───────────────────────────────────────────
async def request_human_review(
    hive: HiveSession,
    summary: str,
    emit: Callable[[str, str], None],
    timeout_seconds: int = 300,
) -> bool:
    """
    Emit a REVIEW_REQUEST event and wait up to `timeout_seconds` for approval.
    Returns True if approved (or timed-out with auto-approve), False if rejected.
    Auto-approves after timeout to prevent infinite blocking.
    """
    hive_id = hive.id
    review_id = str(uuid.uuid4())

    # Create a wakeup event
    ev = asyncio.Event()
    _hive_review_events[hive_id] = ev
    _hive_review_approved[hive_id] = True  # default: auto-approve on timeout

    emit("info", f"⏸  Waiting for human review (timeout {timeout_seconds}s)…")
    emit_event(
        "STATUS",
        hive_id=hive_id,
        agent_id="system",
        data={
            "status": "review_requested",
            "review_id": review_id,
            "summary": summary[:500],
        },
    )

    # ── Persist review request to database ────────────────────────────────
    await db_save_review_request(
        hive_id=hive_id,
        agent_id="system",
        review_id=review_id,
        summary=summary,
    )

    try:
        await asyncio.wait_for(ev.wait(), timeout=float(timeout_seconds))
    except asyncio.TimeoutError:
        emit("warning", f"Review timed out — auto-approving deployment.")

    approved = _hive_review_approved.get(hive_id, True)
    _hive_review_events.pop(hive_id, None)
    _hive_review_approved.pop(hive_id, None)

    # ── Update review status in database ──────────────────────────────────
    await db_resolve_review_request(hive_id=hive_id, approved=approved)

    emit("info", f"Review {'approved ✅' if approved else 'rejected ❌'}")
    return approved


def resolve_review(hive_id: str, approved: bool) -> bool:
    """Called by the API when the user clicks Approve/Reject in the dashboard."""
    ev = _hive_review_events.get(hive_id)
    if not ev:
        return False
    _hive_review_approved[hive_id] = approved
    ev.set()
    return True


# ─── Worker Executor ──────────────────────────────────────────────────────────
async def run_worker(
    node: AgentNode,
    hive: HiveSession,
    session_dir: Path,
    parent_context: dict | None = None,
) -> None:
    hive_id = hive.id
    agent_id = node.id

    def emit(level: str, message: str) -> None:
        hive.add_log(level, f"[{node.role.upper()}] {message}", agent_id=agent_id)

    # Guard: killed by budget
    if _is_killed(hive_id):
        emit("warning", "Session killed (budget exceeded) — not starting.")
        node.status = "error"
        return

    # SPAWN event is already emitted by make_spawn_tool; emit STATUS: thinking
    node.status = "thinking"
    emit_event("STATUS", hive_id, agent_id, {"status": "thinking", "role": node.role}, role=node.role)
    await db_upsert_agent(agent_id, hive_id, node.role, "thinking", node.parent_id, node.specialized_task)
    emit("info", f"Worker spawned — role: {node.role}")
    emit("info", f"Task: {node.specialized_task[:120]}")

    # Build context block from parent + message bus
    context_parts: list[str] = []
    if parent_context:
        context_parts.append(f"Parent context:\n{json.dumps(parent_context, indent=2)}")
    for topic, messages in hive.message_bus.get_all().items():
        if messages:
            context_parts.append(f"Shared artifact [{topic}]:\n{json.dumps(messages[-1], indent=2)}")
    context_block = "\n\n".join(context_parts) if context_parts else ""

    system_prompt = get_system_prompt(node.role)

    worker_prompt = f"""
{f'## Context from other agents:{chr(10)}{context_block}' if context_block else ''}

## Your specific task
{node.specialized_task}

## Instructions
{node.local_context.get('instructions', 'Complete the task thoroughly and professionally.')}

## Workspace
All files should be written with relative paths (they will be created inside the session workspace).

Begin immediately. Do not ask for clarification.
"""

    try:
        all_roles = [n.role for n in hive.agents.values()]
        agent = create_agent(
            provider=hive.provider,
            model=hive.model,
            log_emitter=emit,
        )
        agent.SYSTEM_PROMPT = system_prompt  # type: ignore[attr-defined]

        node.status = "working"
        emit_event("STATUS", hive_id, agent_id, {"status": "working", "role": node.role}, role=node.role, all_roles=all_roles)
        await db_upsert_agent(agent_id, hive_id, node.role, "working", node.parent_id, node.specialized_task)
        emit("info", "Processing task with LLM...")

        # Emit THOUGHT before LLM call
        emit_event("THOUGHT", hive_id, agent_id, {
            "role": node.role,
            "task_preview": node.specialized_task[:200],
        }, role=node.role, all_roles=all_roles)

        response = await agent.think(worker_prompt)
        _accumulate_chars(hive_id, response)

        # Check budget after LLM call
        if await _check_budget(hive, emit):
            node.status = "error"
            return

        # Emit the reasoning/response as THOUGHT chunks
        for line in response.split("\n"):
            line = line.strip()
            if line:
                emit_event("THOUGHT", hive_id, agent_id, {"line": line}, role=node.role)

        emit("info", "LLM response received — executing actions...")

        actions = _extract_actions(response)

        if not actions:
            emit("warning", "No structured actions found in response.")
            for line in response.split("\n"):
                if line.strip():
                    emit("info", f"  {line}")
        else:
            fs = EventedFileSystemTool(session_dir, emit, hive_id, agent_id, role=node.role)
            terminal = EventedTerminalTool(session_dir, emit, hive_id, agent_id, role=node.role)
            written_files: list[dict] = []  # track for self-healer context

            for i, action in enumerate(actions, 1):
                # Budget check per action
                if _is_killed(hive_id):
                    emit("warning", "Budget exceeded — stopping action execution.")
                    break

                action_type = action.get("action", "").lower()
                emit("info", f"  [{i}/{len(actions)}] {action_type}")
                emit_event("TOOL_CALL", hive_id, agent_id, {
                    "tool": action_type,
                    "index": i,
                    "total": len(actions),
                    **{k: v for k, v in action.items() if k != "action"},
                }, role=node.role)

                if action_type == "write_file":
                    path = action.get("path", "output.txt")
                    content = action.get("content", "")
                    fs.write_file(path, content)
                    written_files.append({"path": path, "content": content[:800]})

                elif action_type == "mkdir":
                    fs.mkdir(action.get("path", "."))

                elif action_type == "read_dir":
                    result = fs.read_dir(action.get("path", "."))
                    if result["success"]:
                        emit("info", f"  Found {len(result['entries'])} entries")

                elif action_type == "execute_command":
                    cmd = action.get("command", "echo done")
                    cwd = action.get("cwd", None)
                    timeout = action.get("timeout", 120)

                    await terminal.execute_async(command=cmd, cwd=cwd, timeout=timeout)

                    # ── Self-Healing Loop ──────────────────────────────
                    raw_out = terminal.last_output
                    exit_code = terminal.last_exit_code

                    if is_error_output(raw_out, exit_code):
                        node.status = "fixing"
                        emit_event(
                            "STATUS", hive_id, agent_id,
                            {"status": "fixing", "role": node.role, "error_hint": raw_out[:200]},
                            role=node.role,
                        )
                        await db_upsert_agent(agent_id, hive_id, node.role, "fixing", node.parent_id, node.specialized_task)
                        emit("warning", f"🔧 Error detected (exit {exit_code}) — initiating self-heal…")

                        healed = False
                        for heal_attempt in range(1, MAX_HEAL_ATTEMPTS + 1):
                            heal_result = await attempt_self_heal(
                                agent=agent,
                                command=cmd,
                                error_output=raw_out,
                                exit_code=exit_code,
                                context_files=written_files,
                                emit=emit,
                                attempt=heal_attempt,
                            )
                            _accumulate_chars(hive_id, heal_result.get("explanation", ""))

                            # Apply file patches
                            patch_actions = heal_result.get("actions", [])
                            if patch_actions:
                                for pa in patch_actions:
                                    if pa.get("action") == "write_file":
                                        ppath = pa.get("path", "")
                                        pcontent = pa.get("content", "")
                                        fs.write_file(ppath, pcontent)
                                        written_files.append({"path": ppath, "content": pcontent[:800]})
                                        emit("info", f"  [PATCH] Rewrote {ppath}")

                                # Re-run the command
                                emit("info", f"  [HEAL-{heal_attempt}] Re-running: {cmd}")
                                await terminal.execute_async(command=cmd, cwd=cwd, timeout=timeout)
                                raw_out = terminal.last_output
                                exit_code = terminal.last_exit_code

                                if not is_error_output(raw_out, exit_code):
                                    emit("success", f"  ✅ Self-heal succeeded on attempt {heal_attempt}!")
                                    healed = True
                                    node.status = "working"
                                    emit_event(
                                        "STATUS", hive_id, agent_id,
                                        {"status": "working", "role": node.role},
                                        role=node.role,
                                    )
                                    break
                            else:
                                emit("warning", f"  [HEAL-{heal_attempt}] No patches generated — retrying LLM fix…")

                            if await _check_budget(hive, emit):
                                break

                        if not healed:
                            emit("warning", f"  ⚠️ Self-heal exhausted ({MAX_HEAL_ATTEMPTS} attempts) — continuing anyway.")
                    # ── End Self-Healing Loop ──────────────────────────

                elif action_type == "publish_artifact":
                    topic = action.get("topic", "artifact")
                    payload = action.get("payload", {})
                    all_roles = [n.role for n in hive.agents.values()]
                    hive.message_bus.publish(topic, payload)
                    emit_event("ARTIFACT", hive_id, agent_id, {"topic": topic, "payload": payload},
                               role=node.role, all_roles=all_roles)
                    emit("success", f"Published artifact to bus: [{topic}]")

                else:
                    emit("warning", f"  Unknown action '{action_type}', skipping.")

                await asyncio.sleep(0.05)

        node.status = "completed"
        node.completed_at = datetime.utcnow().isoformat()
        emit_event("STATUS", hive_id, agent_id, {"status": "completed", "role": node.role}, role=node.role)
        emit_event("DONE", hive_id, agent_id, {"role": node.role}, role=node.role)
        await db_upsert_agent(agent_id, hive_id, node.role, "completed", node.parent_id, node.specialized_task)
        emit("success", f"Worker [{node.role}] completed!")

    except Exception as exc:
        node.status = "error"
        emit_event("STATUS", hive_id, agent_id, {"status": "error", "role": node.role}, role=node.role)
        emit_event("ERROR", hive_id, agent_id, {"error": str(exc), "type": type(exc).__name__}, role=node.role)
        await db_upsert_agent(agent_id, hive_id, node.role, "error", node.parent_id, node.specialized_task)
        emit("error", f"Worker [{node.role}] crashed: {type(exc).__name__}: {exc}")


# ─── Spawn Agent Tool ─────────────────────────────────────────────────────────
def make_spawn_tool(
    hive: HiveSession,
    session_dir: Path,
    parent_id: str,
    pending_workers: list[tuple[AgentNode, dict]],
    emit: Callable[[str, str], None],
) -> Callable[[dict], None]:

    def spawn_agent(action: dict) -> None:
        role = action.get("role", "worker")
        task = action.get("task", "")
        instructions = action.get("instructions", "")

        node = AgentNode(
            id=str(uuid.uuid4()),
            role=role,
            session_id=hive.id,
            parent_id=parent_id,
            status="idle",
            specialized_task=task,
            local_context={"instructions": instructions},
        )
        hive.register_agent(node)
        pending_workers.append((node, {}))

        # Emit SPAWN event immediately
        emit_event(
            "SPAWN",
            hive_id=hive.id,
            agent_id=node.id,
            parent_id=parent_id,
            data={
                "role": role,
                "task_preview": task[:120],
                "parent_id": parent_id,
            },
        )

        emit(
            "info",
            f"Manager spawned Worker: [{role}] — Task: {task[:80]}{'...' if len(task) > 80 else ''}",
        )
        hive.add_log(
            "info",
            f"[HIVE] New agent registered: {node.id[:8]} / role={role}",
            agent_id=node.id,
        )
        # Emit manager's delegation as a CHAT message
        all_roles = [n.role for n in hive.agents.values()]
        delegation = build_spawn_delegation_message("manager", role, task)
        from app.events import HiveEvent
        import asyncio as _asyncio
        try:
            loop = _asyncio.get_running_loop()
            from app.events import event_bus as _bus
            _bus_ev = HiveEvent(
                event_type="CHAT",  # type: ignore[arg-type]
                hive_id=hive.id,
                agent_id=parent_id,
                data=delegation,
                parent_id=None,
            )
            loop.create_task(_bus.publish(_bus_ev))
        except Exception:
            pass

    return spawn_agent


# ─── Hive Executor  ───────────────────────────────────────────────────────────
async def execute_hive(
    hive: HiveSession,
    budget_limit: float = _DEFAULT_BUDGET_LIMIT,
    require_review: bool = False,
    run_qa: bool = True,
) -> None:
    hive.status = "running"
    hive_id = hive.id

    # Reset per-hive state
    _hive_char_counters[hive_id] = 0
    _hive_killed[hive_id] = False

    def emit(level: str, message: str) -> None:
        hive.add_log(level, message, agent_id="system")

    emit("info", "AgentHive orchestrator starting...")
    emit("info", f"Provider: {hive.provider} | Model: {hive.model}")
    emit("info", f"Objective: {hive.prompt[:120]}")
    emit("info", f"Budget limit: ${budget_limit:.2f}")

    # Persist hive session to DB
    await db_upsert_hive(
        hive_id, hive.prompt, hive.provider, hive.model, "running", budget_limit
    )

    session_dir = config.WORKSPACE_DIR / f"hive-{hive_id[:8]}"
    session_dir.mkdir(parents=True, exist_ok=True)
    emit("info", f"Workspace: {session_dir.name}")

    # ── Create Manager agent ──────────────────────────────────────────────────
    manager_node = AgentNode(
        id=str(uuid.uuid4()),
        role="manager",
        session_id=hive_id,
        parent_id=None,
        status="thinking",
        specialized_task=hive.prompt,
    )
    hive.register_agent(manager_node)

    # Emit SPAWN for manager (it's the root node)
    emit_event("SPAWN", hive_id, manager_node.id, {
        "role": "manager",
        "task_preview": hive.prompt[:120],
        "parent_id": None,
    }, role="manager")
    emit_event("STATUS", hive_id, manager_node.id, {"status": "thinking", "role": "manager"}, role="manager")
    hive.add_log("info", f"[MANAGER] Prime Agent online: {manager_node.id[:8]}", agent_id=manager_node.id)

    pending_workers: list[tuple[AgentNode, dict]] = []

    def manager_emit(level: str, message: str) -> None:
        hive.add_log(level, f"[MANAGER] {message}", agent_id=manager_node.id)

    spawn_tool = make_spawn_tool(hive, session_dir, manager_node.id, pending_workers, manager_emit)

    # ── Run Manager ───────────────────────────────────────────────────────────
    try:
        manager_agent = create_agent(
            provider=hive.provider,
            model=hive.model,
            log_emitter=manager_emit,
        )
        manager_agent.SYSTEM_PROMPT = MANAGER_SYSTEM_PROMPT  # type: ignore[attr-defined]

        manager_emit("info", "Analyzing requirement and planning sub-tasks...")
        emit_event("THOUGHT", hive_id, manager_node.id, {
            "line": f"Planning: {hive.prompt[:200]}"
        }, role="manager")

        manager_prompt = f"""
## User Requirement
{hive.prompt}

## Your job
1. Write a brief project plan.
2. Spawn 2–4 specialized Workers using `spawn_agent` action blocks.
3. Each worker must receive a clear, detailed, self-contained task description.

Start now.
"""
        response = await manager_agent.think(manager_prompt)
        manager_node.status = "working"
        emit_event("STATUS", hive_id, manager_node.id, {"status": "working", "role": "manager"}, role="manager")

        # Stream manager's thinking as THOUGHT events
        for line in response.split("\n"):
            line = line.strip()
            if line:
                emit_event("THOUGHT", hive_id, manager_node.id, {"line": line}, role="manager")
                manager_emit("info", f"  {line}")

        # Parse spawn actions
        actions = _extract_actions(response)
        spawn_actions = [a for a in actions if a.get("action") == "spawn_agent"]

        if not spawn_actions:
            manager_emit("warning", "No spawn_agent calls found — Manager executing directly.")
            from app.executor import _run_actions
            fs = EventedFileSystemTool(session_dir, manager_emit, hive_id, manager_node.id)
            terminal = EventedTerminalTool(session_dir, manager_emit, hive_id, manager_node.id)
            non_spawn = [a for a in actions if a.get("action") != "spawn_agent"]
            if non_spawn:
                await _run_actions(non_spawn, fs, terminal, manager_emit)
        else:
            for sa in spawn_actions:
                spawn_tool(sa)

        manager_emit("info", f"Planning complete — {len(pending_workers)} Workers queued")

    except Exception as exc:
        manager_node.status = "error"
        emit_event("ERROR", hive_id, manager_node.id, {"error": str(exc)})
        emit("error", f"Manager crashed: {type(exc).__name__}: {exc}")
        hive.complete(success=False)
        return

    # ── Run Workers concurrently ──────────────────────────────────────────────
    if pending_workers:
        emit("info", f"Launching {len(pending_workers)} Workers in parallel...")
        tasks = [
            asyncio.create_task(run_worker(node, hive, session_dir, ctx))
            for node, ctx in pending_workers
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    # ── Budget check after workers ─────────────────────────────────────────────
    if _is_killed(hive_id):
        emit("error", "Session terminated due to budget limit.")
        await db_upsert_hive(hive_id, hive.prompt, hive.provider, hive.model, "killed", budget_limit)
        hive.complete(success=False)
        return

    # ── QA Gate ───────────────────────────────────────────────────────────────
    qa_passed = True
    if run_qa and pending_workers:
        emit("info", "🔍 Starting QA Gate — spawning QA Agent…")
        artifact_summary = "\n".join(
            f"- [{n.role}]: {n.specialized_task[:100]}"
            for n in hive.agents.values()
            if n.id != manager_node.id and n.role != "qa_engineer"
        )
        qa_passed = await run_qa_agent(
            hive=hive,
            session_dir=session_dir,
            parent_id=manager_node.id,
            artifact_summary=artifact_summary,
        )
        if qa_passed:
            emit("success", "✅ QA Gate passed — proceeding to deployment.")
        else:
            emit("warning", "⚠️ QA Gate had failures — review recommended.")

    # ── Human-in-the-loop Review (optional) ───────────────────────────────────
    if require_review:
        summary = f"QA {'passed' if qa_passed else 'had issues'}. Project is ready for review.\n"
        summary += "\n".join(
            f"- {n.role}: {n.status}" for n in hive.agents.values()
        )
        approved = await request_human_review(hive, summary, emit)
        if not approved:
            emit("warning", "Deployment rejected by reviewer.")
            hive.complete(success=False)
            await db_upsert_hive(hive_id, hive.prompt, hive.provider, hive.model, "rejected", budget_limit)
            return

    # ── Supervisor check ──────────────────────────────────────────────────────
    all_ok = all(
        n.status in ("completed", "error")
        for n in hive.agents.values()
        if n.id != manager_node.id and n.role != "qa_engineer"
    ) and qa_passed

    manager_node.status = "completed"
    manager_node.completed_at = datetime.utcnow().isoformat()
    emit_event("STATUS", hive_id, manager_node.id, {"status": "completed", "role": "manager"}, role="manager")
    await db_upsert_agent(manager_node.id, hive_id, "manager", "completed", None, hive.prompt)

    final_status = "completed" if all_ok else "failed"
    await db_upsert_hive(hive_id, hive.prompt, hive.provider, hive.model, final_status, budget_limit)

    if all_ok or not pending_workers:
        emit_event("DONE", hive_id, "system", {"hive_id": hive_id, "success": True, "qa_passed": qa_passed}, role="manager")
        emit("success", "All Workers completed — Hive session finished!")
        hive.complete(success=True)
    else:
        failed = [n.role for n in hive.agents.values() if n.status == "error"]
        emit_event("DONE", hive_id, "system", {"hive_id": hive_id, "success": False, "failed": failed}, role="manager")
        emit("warning", f"Some Workers failed: {', '.join(failed)}")
        hive.complete(success=False)

    # ── Save final token usage snapshot to DB ─────────────────────────────────
    total_chars = _hive_char_counters.get(hive_id, 0)
    if total_chars > 0:
        prompt_tokens     = int(total_chars / 4 * 0.4)   # rough 40% prompt share
        completion_tokens = int(total_chars / 4 * 0.6)   # rough 60% completion share
        rate = _COST_PER_1K.get(hive.provider, 0.003)
        cost_usd = ((prompt_tokens + completion_tokens) / 1000) * rate
        await db_save_token_usage(
            hive_id=hive_id,
            provider=hive.provider,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=round(cost_usd, 6),
        )

    # Cleanup in-memory counters
    _hive_char_counters.pop(hive_id, None)
    _hive_killed.pop(hive_id, None)
