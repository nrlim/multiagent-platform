"""
AgentHive Engine - FileSystemTool
Provides file and directory operations within the agent workspace.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Callable

from app.agents.base import LogEmitter
from app import config


class FileSystemTool:
    """Safe file-system operations scoped to the workspace directory."""

    def __init__(self, session_dir: Path, log_emitter: LogEmitter | None = None):
        self.session_dir = session_dir
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self._log = log_emitter or (lambda level, msg: print(f"[{level.upper()}] {msg}"))

    def _resolve(self, relative_path: str) -> Path:
        """Resolve a relative path safely within the session directory."""
        target = (self.session_dir / relative_path).resolve()
        # Security: prevent path traversal outside workspace
        if not str(target).startswith(str(config.WORKSPACE_DIR.resolve())):
            raise PermissionError(
                f"Path '{relative_path}' escapes the workspace sandbox."
            )
        return target

    def write_file(self, relative_path: str, content: str) -> dict:
        """
        Create or overwrite a file within the session workspace.

        Args:
            relative_path: Path relative to the session directory.
            content: File content as a string.

        Returns:
            Dict with 'success', 'path', 'bytes_written'.
        """
        target = self._resolve(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)

        self._log("file", f"📝 Writing file: {relative_path}")
        target.write_text(content, encoding="utf-8")
        bytes_written = target.stat().st_size

        self._log("success", f"✅ Created: {relative_path} ({bytes_written} bytes)")
        return {"success": True, "path": str(target), "bytes_written": bytes_written}

    def read_file(self, relative_path: str) -> dict:
        """Read a file from the session workspace."""
        target = self._resolve(relative_path)
        if not target.exists():
            return {"success": False, "error": f"File not found: {relative_path}"}
        content = target.read_text(encoding="utf-8")
        return {"success": True, "path": str(target), "content": content}

    def read_dir(self, relative_path: str = ".") -> dict:
        """
        List directory contents recursively.

        Returns:
            Dict with 'success', 'entries' (list of file/dir metadata dicts).
        """
        target = self._resolve(relative_path)
        self._log("info", f"📂 Reading directory: {relative_path}")

        if not target.exists():
            return {"success": False, "error": f"Directory not found: {relative_path}"}

        entries = []
        for item in sorted(target.rglob("*")):
            rel = item.relative_to(self.session_dir)
            entries.append({
                "name": item.name,
                "path": str(rel).replace("\\", "/"),
                "type": "directory" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
                "extension": item.suffix.lstrip(".") or None,
            })

        return {"success": True, "path": str(target), "entries": entries}

    def delete_file(self, relative_path: str) -> dict:
        """Delete a file or directory from the workspace."""
        target = self._resolve(relative_path)
        if not target.exists():
            return {"success": False, "error": f"Path not found: {relative_path}"}

        self._log("warning", f"🗑️ Deleting: {relative_path}")
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()

        self._log("success", f"✅ Deleted: {relative_path}")
        return {"success": True, "path": str(target)}

    def mkdir(self, relative_path: str) -> dict:
        """Create a directory (and parents) in the workspace."""
        target = self._resolve(relative_path)
        target.mkdir(parents=True, exist_ok=True)
        self._log("file", f"📁 Created directory: {relative_path}")
        return {"success": True, "path": str(target)}
