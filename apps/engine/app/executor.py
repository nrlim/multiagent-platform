"""
AgentHive Engine - Core Agent Executor
Orchestrates the full agent loop: LLM → parse actions → tools → log results.
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from app.agents.factory import create_agent
from app.session import AgentSession, session_store
from app.tools.filesystem import FileSystemTool
from app.tools.terminal import TerminalTool
from app import config


# ─── Action Parser ────────────────────────────────────────────────────────────
_ACTION_PATTERN = re.compile(
    r"```(?:action|json)?\s*\{.*?\}\s*```",
    re.DOTALL | re.IGNORECASE,
)


def _extract_actions(text: str) -> list[dict]:
    """Extract JSON action blocks from LLM response text."""
    actions = []
    for match in _ACTION_PATTERN.finditer(text):
        raw = match.group(0)
        raw = re.sub(r"```(?:action|json)?", "", raw).strip().strip("`").strip()
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and "action" in obj:
                actions.append(obj)
        except json.JSONDecodeError:
            pass
    return actions


# ─── Executor ─────────────────────────────────────────────────────────────────
async def execute_session(session: AgentSession) -> None:
    """
    Run the full agent execution loop for a session.
    This function is designed to be run as a background asyncio task.
    """
    session.status = "running"

    def emit(level: str, message: str) -> None:
        session.add_log(level, message)

    emit("info", f"🚀 Starting AgentHive session [{session.id[:8]}]")
    emit("info", f"📡 Provider: {session.provider} | Model: {session.model}")
    emit("info", f"📋 Task: {session.prompt[:120]}{'...' if len(session.prompt) > 120 else ''}")

    # Setup session workspace
    session_dir = config.WORKSPACE_DIR / f"session-{session.id[:8]}"
    session_dir.mkdir(parents=True, exist_ok=True)
    emit("info", f"📁 Workspace: {session_dir.name}")

    fs = FileSystemTool(session_dir=session_dir, log_emitter=emit)
    terminal = TerminalTool(session_dir=session_dir, log_emitter=emit)

    try:
        agent = create_agent(
            provider=session.provider,
            model=session.model,
            log_emitter=emit,
        )

        # ── Phase 1: Plan ──────────────────────────────────────────────────────
        plan_prompt = f"""
You are working in directory: {session_dir}

TASK: {session.prompt}

First, create a detailed execution plan. List exactly what files you will create and what commands you will run.
Then execute the plan step by step.

For each file you create, output a JSON action block like:
```action
{{"action": "write_file", "path": "relative/path/to/file.ext", "content": "...file content..."}}
```

For each command you run, output:
```action
{{"action": "execute_command", "command": "npm install", "cwd": "optional/subdir"}}
```

For creating directories:
```action
{{"action": "mkdir", "path": "directory/path"}}
```

Begin your plan and execution now. Be thorough and complete.
"""

        emit("info", "🧠 Agent is thinking and planning...")
        response = await agent.think(plan_prompt)
        emit("info", "📜 Agent response received, parsing actions...")

        # ── Phase 2: Execute Actions ───────────────────────────────────────────
        actions = _extract_actions(response)

        if not actions:
            emit("warning", "⚠️ No structured actions found. Attempting direct execution...")
            # Fallback: just log the response
            for line in response.split("\n"):
                if line.strip():
                    emit("info", f"  {line}")
        else:
            emit("info", f"⚙️ Found {len(actions)} actions to execute")
            await _run_actions(actions, fs, terminal, emit)

        emit("success", "🎉 Agent session completed successfully!")
        session.complete(success=True)

    except Exception as exc:
        emit("error", f"💥 Fatal error: {type(exc).__name__}: {exc}")
        session.complete(success=False)


async def _run_actions(
    actions: list[dict],
    fs: FileSystemTool,
    terminal: TerminalTool,
    emit,
) -> None:
    """Dispatch each parsed action to the correct tool."""
    for i, action in enumerate(actions, 1):
        action_type = action.get("action", "").lower()
        emit("info", f"[{i}/{len(actions)}] Executing: {action_type}")

        if action_type == "write_file":
            result = fs.write_file(
                relative_path=action.get("path", "output.txt"),
                content=action.get("content", ""),
            )
            if not result["success"]:
                emit("error", f"Failed to write file: {result.get('error')}")

        elif action_type == "mkdir":
            result = fs.mkdir(action.get("path", "."))

        elif action_type == "read_dir":
            result = fs.read_dir(action.get("path", "."))
            if result["success"]:
                emit("info", f"  Found {len(result['entries'])} entries")

        elif action_type == "delete_file":
            result = fs.delete_file(action.get("path", ""))

        elif action_type == "execute_command":
            result = await terminal.execute_async(
                command=action.get("command", "echo done"),
                cwd=action.get("cwd", None),
                timeout=action.get("timeout", 120),
            )

        else:
            emit("warning", f"  Unknown action type: '{action_type}', skipping.")

        # Small delay between actions to keep logs readable
        await asyncio.sleep(0.05)
