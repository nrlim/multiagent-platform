"""
AgentHive Engine - TerminalTool
Subprocess management for executing shell commands within the agent workspace.
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path
from typing import Callable

from app.agents.base import LogEmitter


class TerminalTool:
    """Safe subprocess execution scoped to a session directory."""

    # Commands that are never allowed for security
    BLOCKED_COMMANDS = {"rm -rf /", "format", "mkfs", "dd", ":(){ :|:& };:"}

    def __init__(self, session_dir: Path, log_emitter: LogEmitter | None = None):
        self.session_dir = session_dir
        self._log = log_emitter or (lambda level, msg: print(f"[{level.upper()}] {msg}"))

    def _is_safe(self, command: str) -> bool:
        """Basic command safety check."""
        cmd_lower = command.lower().strip()
        for blocked in self.BLOCKED_COMMANDS:
            if blocked in cmd_lower:
                return False
        return True

    def execute_command(
        self,
        command: str,
        cwd: str | None = None,
        timeout: int = 120,
        env: dict | None = None,
    ) -> dict:
        """
        Execute a shell command synchronously, streaming output line-by-line.

        Args:
            command: Shell command string to run.
            cwd: Working directory relative to session_dir. Defaults to session root.
            timeout: Max execution time in seconds.
            env: Extra environment variables to merge.

        Returns:
            Dict with 'success', 'returncode', 'stdout', 'stderr'.
        """
        if not self._is_safe(command):
            self._log("error", f"🚫 Blocked dangerous command: {command}")
            return {"success": False, "error": "Command blocked for security reasons."}

        work_dir = self.session_dir
        if cwd:
            work_dir = (self.session_dir / cwd).resolve()

        self._log("command", f"$ {command}")

        try:
            import os
            merged_env = {
                **os.environ,
                "npm_config_yes": "true",     # Auto-answer 'yes' to npm/npx package install prompts
                **(env or {})
            }

            process = subprocess.Popen(
                command,
                shell=True,
                cwd=str(work_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,  # Merge stderr into stdout to prevent pipe deadlocks
                text=True,
                encoding="utf-8",
                errors="replace",
                env=merged_env,
            )

            stdout_lines: list[str] = []

            # Stream stdout (which now includes stderr) live
            assert process.stdout is not None
            for line in iter(process.stdout.readline, ""):
                line = line.rstrip()
                if line:
                    stdout_lines.append(line)
                    self._log("info", f"  {line}")

            process.wait(timeout=timeout)

            success = process.returncode == 0
            if success:
                self._log("success", f"✅ Command completed (exit {process.returncode})")
            else:
                self._log("error", f"❌ Command failed (exit {process.returncode})")

            return {
                "success": success,
                "returncode": process.returncode,
                "stdout": "\n".join(stdout_lines),
                "stderr": "",  # Merged into stdout
            }

        except subprocess.TimeoutExpired:
            process.kill()
            self._log("error", f"⏰ Command timed out after {timeout}s")
            return {"success": False, "error": f"Command timed out after {timeout}s"}
        except Exception as e:
            self._log("error", f"❌ Execution error: {e}")
            return {"success": False, "error": str(e)}

    async def execute_async(
        self,
        command: str,
        cwd: str | None = None,
        timeout: int = 120,
    ) -> dict:
        """Async wrapper around the sync execute_command."""
        loop = asyncio.get_running_loop()
        import functools
        
        # Run the synchronous Popen execution in a thread pool to avoid 
        # Windows asyncio subprocess issues with the event loop.
        func = functools.partial(
            self.execute_command, 
            command=command, 
            cwd=cwd, 
            timeout=timeout
        )
        return await loop.run_in_executor(None, func)
