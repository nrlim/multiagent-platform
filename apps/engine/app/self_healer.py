"""
AgentHive Engine - Self-Healing Loop (Phase 5)

When a `execute_command` action returns a non-zero exit code or contains
common error signatures (SyntaxError, ModuleNotFoundError, etc.), the
SelfHealer re-prompts the originating LLM agent with the error context
and a fix directive, then replaces the broken files and re-runs the command.

Max retries: configurable (default 3).
"""
from __future__ import annotations

import re
from typing import Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from app.agents.base import BaseAgent

# ─── Error signature heuristics ───────────────────────────────────────────────
_ERROR_PATTERNS = [
    re.compile(r"SyntaxError", re.IGNORECASE),
    re.compile(r"ModuleNotFoundError", re.IGNORECASE),
    re.compile(r"ImportError", re.IGNORECASE),
    re.compile(r"NameError", re.IGNORECASE),
    re.compile(r"TypeError", re.IGNORECASE),
    re.compile(r"AttributeError", re.IGNORECASE),
    re.compile(r"IndentationError", re.IGNORECASE),
    re.compile(r"ENOENT", re.IGNORECASE),
    re.compile(r"Cannot find module", re.IGNORECASE),
    re.compile(r"error TS\d+", re.IGNORECASE),     # TypeScript errors
    re.compile(r"npm ERR!", re.IGNORECASE),
    re.compile(r"ERROR in ", re.IGNORECASE),
    re.compile(r"failed with exit code [^0]"),
    re.compile(r"Build failed", re.IGNORECASE),
]

MAX_HEAL_ATTEMPTS = 3


def is_error_output(output: str, exit_code: int) -> bool:
    """Return True if the command output indicates a failure that can be auto-fixed."""
    if exit_code != 0:
        return True
    return any(p.search(output) for p in _ERROR_PATTERNS)


def extract_error_summary(output: str, max_chars: int = 2000) -> str:
    """Extract the most relevant error lines from raw shell output."""
    lines = output.splitlines()
    # Prefer lines that contain error keywords
    error_lines = [l for l in lines if any(p.search(l) for p in _ERROR_PATTERNS)]
    if error_lines:
        summary = "\n".join(error_lines[:30])
    else:
        # Tail of output usually contains the error
        summary = "\n".join(lines[-40:])
    return summary[:max_chars]


async def attempt_self_heal(
    *,
    agent: "BaseAgent",
    command: str,
    error_output: str,
    exit_code: int,
    context_files: list[dict],   # [{"path": str, "content": str}]
    emit: Callable[[str, str], None],
    attempt: int = 1,
) -> dict:
    """
    Ask the LLM to analyse the error and return corrective file writes.

    Returns:
        {"actions": list[dict], "explanation": str}
        where each action is {"action": "write_file", "path": ..., "content": ...}
    """
    import json as _json

    error_summary = extract_error_summary(error_output, 1500)

    file_context = ""
    if context_files:
        file_context = "\n\n".join(
            f"### {f['path']}\n```\n{f['content'][:1000]}\n```"
            for f in context_files[:5]
        )

    heal_prompt = f"""
## 🔧 SELF-HEALING PROTOCOL — Attempt {attempt}/{MAX_HEAL_ATTEMPTS}

You just ran this command:
```
{command}
```

It failed with exit code {exit_code}. Here is the error output:
```
{error_summary}
```

{f"### Relevant source files:{chr(10)}{file_context}" if file_context else ""}

### Your task
1. Identify the root cause of the error.
2. Produce the corrected file(s) as JSON action blocks.
3. Output ONLY the fix — no explanations outside action blocks.

Use this format for each file fix:
```action
{{"action": "write_file", "path": "relative/path/to/file.ext", "content": "...corrected content..."}}
```

Begin fixing now.
""".strip()

    emit("warning", f"[HEAL-{attempt}] Analyzing error and generating fix…")
    try:
        response = await agent.think(heal_prompt)
        emit("info", f"[HEAL-{attempt}] Fix proposal received — applying patches…")

        # Parse action blocks from response
        import re as _re
        pattern = _re.compile(r"```(?:action|json)?\s*(\{.*?\})\s*```", _re.DOTALL | _re.IGNORECASE)
        actions = []
        for m in pattern.finditer(response):
            try:
                obj = _json.loads(m.group(1))
                if isinstance(obj, dict) and obj.get("action") in ("write_file", "mkdir"):
                    actions.append(obj)
            except _json.JSONDecodeError:
                pass

        explanation_lines = [l for l in response.split("\n") if l.strip() and not l.strip().startswith("{") and not l.strip().startswith("```")]
        explanation = " ".join(explanation_lines[:5])[:300]

        return {"actions": actions, "explanation": explanation}

    except Exception as exc:
        emit("error", f"[HEAL-{attempt}] Heal attempt failed: {exc}")
        return {"actions": [], "explanation": str(exc)}
