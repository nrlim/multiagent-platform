"""
AgentHive Engine - Dialogue Translation Layer (Phase 4)
Converts raw agent actions/events into human-like team chat messages.
Each role has a distinct professional personality.
"""
from __future__ import annotations

import random
import re
from typing import Any


# ─── Role personality definitions ────────────────────────────────────────────
ROLE_PERSONAS: dict[str, dict] = {
    "manager": {
        "display": "Project Manager",
        "tone": "formal",
        "greeting": [
            "Alright team, let's get this project started!",
            "Good morning everyone. Time to build something great.",
            "Attention team — I've analysed the requirements and we have a clear path forward.",
        ],
        "delegating": [
            "@{role} I need you to handle the {task_short}. Please proceed immediately.",
            "Assigning {task_short} to @{role}. This is your top priority.",
            "@{role} — you're up. Take ownership of {task_short}.",
        ],
        "done": [
            "Excellent work everyone. All deliverables are ready for review.",
            "The team has completed all assigned tasks. Well done!",
            "Wrapping up — all agents have finished. Solid execution, team.",
        ],
    },
    "database_architect": {
        "display": "DB Architect",
        "tone": "technical",
        "spawn": [
            "Hey team 👋 DB Architect here. I'll be designing the data layer.",
            "Database Architect online. Ready to model the schema.",
        ],
        "working": [
            "Designing the schema now — focusing on normalization and indexing.",
            "Mapping out entity relationships. This needs to scale.",
            "Drafting the migration files. I'll keep constraints tight.",
        ],
        "file_done": [
            "I've just committed `{path}`. The schema is taking shape nicely.",
            "Just wrote `{path}`. Check the table definitions when you get a chance.",
            "`{path}` is done — relationships and indexes are all set.",
        ],
        "artifact": [
            "Schema complete! Published the DB contract to the shared bus. @Backend_Dev feel free to reference it.",
            "Database design locked in. Artifact published — @Backend_Dev you'll find the table list ready.",
        ],
        "done": [
            "All schema files are written. The data layer is solid 🏗️",
            "DB work complete. Let me know if you need any adjustments to the schema.",
        ],
    },
    "backend_dev": {
        "display": "Backend Dev",
        "tone": "collaborative",
        "spawn": [
            "Backend Dev checking in! I'll handle the API and business logic.",
            "Hey all, Backend here. Let me know once the schema is ready — I'll integrate right away.",
        ],
        "working": [
            "Building out the API endpoints. Following RESTful conventions.",
            "Wiring up the service layer. Keeping it modular.",
            "Connecting to the database schema @DB_Architect pushed. Looks clean!",
        ],
        "file_done": [
            "Just pushed `{path}` — the endpoint logic is live.",
            "Done with `{path}`. Handlers are fully wired up.",
            "Committed `{path}`. Let me know if @QA_Engineer wants to test this first.",
        ],
        "artifact": [
            "API spec published! @Frontend_Dev — endpoints are all documented in the bus.",
            "I've published the API contract. @Frontend_Dev you're good to integrate now!",
        ],
        "done": [
            "Backend is fully built. APIs are ready for integration testing 🚀",
            "All server-side logic done. @QA_Engineer — it's your turn!",
        ],
    },
    "frontend_dev": {
        "display": "Frontend Dev",
        "tone": "creative",
        "spawn": [
            "Frontend Dev is here! I'll make it look and feel amazing ✨",
            "UI/UX time! Frontend Dev reporting for duty.",
        ],
        "working": [
            "Building the component tree. Keeping it clean and accessible.",
            "Styling the views. Going for a modern, responsive layout.",
            "Grabbing the API spec from the bus — nice work @Backend_Dev!",
        ],
        "file_done": [
            "Just dropped `{path}` — the UI is coming together!",
            "Pushed `{path}`. The page is rendering beautifully.",
            "`{path}` done. Mobile-responsive and fully typed.",
        ],
        "done": [
            "Frontend complete! All pages and components are polished ✨",
            "UI done! @QA_Engineer — want to take a look at the user flows?",
        ],
    },
    "qa_engineer": {
        "display": "QA Engineer",
        "tone": "skeptical",
        "spawn": [
            "QA Engineer on the case. I'll make sure nothing breaks.",
            "QA here. Time to put this code through its paces.",
        ],
        "working": [
            "Reviewing the business logic. Found a few edge cases to cover.",
            "Writing test scenarios. Covering happy paths AND failure modes.",
            "Running integration checks against @Backend_Dev's endpoints.",
        ],
        "file_done": [
            "Test suite `{path}` written. Coverage looks good.",
            "Added `{path}` — all edge cases documented.",
            "Pushed `{path}`. The regression tests are thorough.",
        ],
        "done": [
            "All tests written. The codebase looks solid — minimal risk 🔍",
            "QA complete. No critical concerns. A few minor notes are in the test files.",
        ],
    },
    "devops_engineer": {
        "display": "DevOps Engineer",
        "tone": "pragmatic",
        "spawn": [
            "DevOps here. I'll handle containers, CI/CD, and deployment.",
            "Infrastructure Engineer online. Let's get this ship-ready.",
        ],
        "working": [
            "Dockerising the app. Minimising image size.",
            "Setting up the CI/CD pipeline. GitHub Actions it is.",
            "Writing the deployment config. Keeping it environment-agnostic.",
        ],
        "file_done": [
            "Infrastructure file `{path}` ready. Should deploy cleanly.",
            "`{path}` committed. The pipeline is configured.",
            "Done with `{path}`. Zero-downtime deploy should be straightforward.",
        ],
        "done": [
            "Infrastructure is set. One `docker compose up` and it runs. 🐳",
            "DevOps complete. The deployment pipeline is production-ready.",
        ],
    },
    "tech_writer": {
        "display": "Tech Writer",
        "tone": "clear",
        "spawn": [
            "Tech Writer here! I'll document everything so nobody's lost.",
            "Documentation Engineer online. Good code deserves good docs.",
        ],
        "working": [
            "Drafting the README. Covering setup, usage, and architecture.",
            "Writing the API docs. Keeping it developer-friendly.",
            "Reviewing the codebase to write accurate, up-to-date documentation.",
        ],
        "file_done": [
            "`{path}` is written and polished. Clear and concise.",
            "Pushed `{path}` — the docs are thorough and easy to follow.",
        ],
        "done": [
            "Documentation is complete. The project is fully documented 📄",
            "Docs done! Everything from setup to architecture is covered.",
        ],
    },
}

_FALLBACK_PERSONA = {
    "display": "Specialist",
    "spawn": ["Agent online and ready."],
    "working": ["Working on the assigned task."],
    "file_done": ["File `{path}` created."],
    "done": ["Task complete."],
}


def _pick(pool: list[str], **kwargs: Any) -> str:
    """Pick a random phrase from pool and format it."""
    return random.choice(pool).format(**kwargs)


def _short_path(path: str) -> str:
    parts = path.replace("\\", "/").split("/")
    return parts[-1] if parts else path


def _short_task(task: str, max_len: int = 60) -> str:
    task = task.strip()
    return task if len(task) <= max_len else task[:max_len].rsplit(" ", 1)[0] + "…"


def _role_display(role: str) -> str:
    return ROLE_PERSONAS.get(role, {}).get("display", role.replace("_", " ").title())


# ─── Public translation function ──────────────────────────────────────────────
def translate_event_to_chat(
    event_type: str,
    role: str,
    data: dict,
    all_roles: list[str] | None = None,
) -> dict | None:
    """
    Converts a raw engine event into a structured chat message dict:
      {
        "type": "chat" | "system" | "thought",
        "role": str,
        "display": str,
        "text": str,
        "mentions": list[str],      # @-mentioned roles
        "code_ref": str | None,     # path/command to display in code drawer
        "is_inner": bool,           # True = inner monologue (thought bubble)
      }
    Returns None if the event should not appear in chat.
    """
    persona = ROLE_PERSONAS.get(role, _FALLBACK_PERSONA)
    display = persona.get("display", _role_display(role))
    base = {
        "type": "chat",
        "role": role,
        "display": display,
        "text": "",
        "mentions": [],
        "code_ref": None,
        "is_inner": False,
    }

    if event_type == "SPAWN":
        pool = persona.get("spawn", ["Agent online."])
        base["text"] = _pick(pool)
        base["type"] = "system"
        return base

    if event_type == "STATUS":
        # Status changes get a human presence line  
        status = data.get("status", "")
        presence = {
            "thinking":          f"{display} is planning…",
            "working":           f"{display} has started working",
            "fixing":            f"🔧 {display} is debugging an error…",
            "review_requested": f"⏸ Waiting for human review",
            "completed":         f"{display} has finished ✓",
            "error":             f"{display} hit an error and needs help",
            "idle":              f"{display} is standing by",
        }.get(status)
        if presence:
            base["type"] = "system"
            base["text"] = presence
            return base
        return None

    if event_type == "THOUGHT":
        line: str = data.get("line", "") or data.get("task_preview", "")
        if not line.strip():
            return None
        # Skip lines that are pure JSON/code fences/action blocks
        if line.startswith("{") or line.startswith("```") or line.startswith("["):
            return None
        if len(line) > 400:
            return None
        if "\"action\"" in line or "spawn_agent" in line:
            return None
        # Short, readable, natural lines become visible chat bubbles
        inner = len(line) > 120 or line.startswith("#") or "action" in line.lower()
        base["type"] = "thought"
        base["text"] = line
        base["is_inner"] = inner
        return base

    if event_type == "TOOL_CALL":
        tool = data.get("tool", "")
        path = data.get("path", "") or data.get("command", "")

        if tool == "write_file":
            short = _short_path(str(path))
            pool = persona.get("file_done", [f"Just committed `{short}`."])
            text = _pick(pool, path=short)
            base["text"] = text
            base["code_ref"] = str(path) if path else None
            return base

        if tool == "execute_command":
            cmd = data.get("command", "")
            base["text"] = "Running a shell command…"
            base["code_ref"] = str(cmd)
            base["is_inner"] = True  # shell output lives in Shell tab
            return base

        if tool == "mkdir":
            dir_path = _short_path(str(data.get("path", ".")))
            base["text"] = f"Setting up the `{dir_path}/` directory structure."
            base["is_inner"] = True
            return base

        if tool == "read_dir":
            dir_path = _short_path(str(data.get("path", ".")))
            base["text"] = f"Scanning folder `{dir_path}` to understand the project layout."
            base["is_inner"] = True
            return base

        if tool == "publish_artifact":
            topic = data.get("topic", "artifact")
            pool = persona.get("artifact", [f"Published artifact [{topic}] to the team bus."])
            mentions = []
            if topic == "database_schema" and all_roles:
                mentions = [r for r in all_roles if "backend" in r]
            if topic == "api_spec" and all_roles:
                mentions = [r for r in all_roles if "frontend" in r or "qa" in r]
            base["text"] = _pick(pool)
            base["mentions"] = mentions
            return base

        # Generic tool call — inner monologue only
        base["text"] = f"Using `{tool}`"
        base["is_inner"] = True
        return base

    if event_type == "FILE_CHANGE":
        path = str(data.get("path", ""))
        short = _short_path(path)
        pool = persona.get("file_done", [f"Committed `{short}`."])
        base["text"] = _pick(pool, path=short)
        base["code_ref"] = path
        return base

    if event_type == "ARTIFACT":
        topic = data.get("topic", "artifact")
        pool = persona.get("artifact", [f"Shared [{topic}] with the team."])
        base["text"] = _pick(pool)
        return base

    if event_type == "DONE":
        pool = persona.get("done", ["Task complete."])
        base["text"] = _pick(pool)
        base["type"] = "system"
        return base

    if event_type == "ERROR":
        error_type = data.get("type", "")
        if error_type == "BudgetExceeded":
            cost = data.get("cost", 0)
            limit = data.get("limit", 2.0)
            base["text"] = f"💸 Budget exceeded (${cost:.3f} ≥ limit ${limit:.2f}). Session killed to prevent infinite loop."
            base["type"] = "system"
            return base
        err = str(data.get("error", "Unknown error"))[:120]
        base["text"] = f"I've hit a snag: {err}"
        base["type"] = "system"
        return base

    return None


def build_spawn_delegation_message(
    manager_role: str,
    worker_role: str,
    task: str,
) -> dict:
    """Returns a CHAT_EVENT dict for the Manager's delegation announcement."""
    persona = ROLE_PERSONAS.get(manager_role, _FALLBACK_PERSONA)
    display = persona.get("display", "Manager")
    task_short = _short_task(task)
    pool = persona.get("delegating", ["@{role} — please handle {task_short}."])
    text = _pick(pool, role=_role_display(worker_role), task_short=task_short)
    return {
        "type": "chat",
        "role": manager_role,
        "display": display,
        "text": text,
        "mentions": [worker_role],
        "code_ref": None,
        "is_inner": False,
    }
