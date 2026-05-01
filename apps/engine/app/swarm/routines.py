"""
AgentHive Swarm Engine - Specialist Routines

Five autonomous routines with "Skill DNA":
  - SwarmDispatcherRoutine: entry point, reads task and routes to the right specialist
  - UiUxScout: design research, produces Design Spec, hands off to Frontend Developer
  - BackendDev: backend API + Clean Architecture, hands off to QA Engineer or DevOps
  - FrontendDev: React/Next.js + Atomic Design, hands off to UiUxScout or QA Engineer
  - QA Engineer: QA + code review, routes back to developer on bugs or calls terminate_and_report

Fixes (v2):
  - MAX_REVISIONS guard: QA Engineer can only send back to a specialist at most 2 times.
    After that it MUST terminate_and_report, preventing infinite loops.
  - All specialist prompts now mandate explicit write_file action blocks.
  - QA Engineer lists workspace files to avoid reviewing non-existent code.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from app.agents.factory import create_agent
from app.db import db_upsert_agent
from app.events import emit_event
from app.hive import (
    EventedFileSystemTool,
    EventedTerminalTool,
    _accumulate_chars,
    _extract_actions,
    _is_killed,
)
from app.session import AgentNode
from app.swarm.core import SwarmContext, SwarmRoutine, Transfer, ParallelTransfer, ParallelBranch
from app.token_optimizer import (
    build_smart_context_block,
    compress_system_prompt,
    estimate_call_cost,
    fast_path_dispatch,
    prompt_token_report,
    should_abort_for_budget,
)
from app.swarm.handoffs import (
    terminate_and_report,
    transfer_to_dispatcher,
    transfer_to_qa_engineer,
    transfer_to_backend_dev,
    transfer_to_frontend_dev,
    transfer_to_uiux_scout,
    transfer_to_uiux_researcher,
    transfer_to_code_reviewer,
)

logger = logging.getLogger(__name__)


# ─── Human-readable CHAT event emitter ───────────────────────────────────────
# These messages appear in the Activity tab as natural team communications.
_SPAWN_MESSAGES: dict[str, list[str]] = {
    "swarm_dispatcher": [
        "Hey team, I just got assigned a new task: **{task}**. Let me figure out who's best suited for this.",
        "New task landed: **{task}**. Analyzing requirements and routing to the right specialist.",
        "Got it — **{task}** is now in the queue. I'll dispatch this to the appropriate agent.",
    ],
    "uiux_researcher": [
        "I'm picking up the design research for **{task}**. Starting with user personas and journey mapping.",
        "On it! Deep-diving into UX patterns for **{task}**. Will have a design spec ready soon.",
        "Starting my research phase for **{task}**. Analyzing competitor patterns and accessibility standards.",
    ],
    "uiux_scout": [
        "I'll handle the UX scouting for **{task}**. Putting together color palettes, typography and component specs.",
        "Assigned to design spec for **{task}**. Let me define the visual system first.",
        "On it — drafting the design specification for **{task}** now.",
    ],
    "backend_dev": [
        "Picked up **{task}**. Starting on the backend — API routes, service layer, and data models.",
        "Backend work for **{task}** is now mine. Following Clean Architecture principles.",
        "Got assigned **{task}**. Setting up the server-side logic and database schema.",
    ],
    "frontend_dev": [
        "Taking ownership of **{task}** on the frontend. Building out the React components now.",
        "I'm on the UI for **{task}**. Following Atomic Design — atoms first, then composing up.",
        "Frontend work for **{task}** assigned to me. Integrating with the API spec and design tokens.",
    ],
    "qa_engineer": [
        "QA time for **{task}**. Going through the code systematically — security, logic, then style.",
        "I've picked up the review for **{task}**. Writing tests and checking for edge cases.",
        "Starting quality review on **{task}**. No blockers get through without my sign-off.",
    ],
    "code_reviewer": [
        "Code review for **{task}** is mine. Checking architecture, security vulnerabilities, and code quality.",
        "Running a thorough review on **{task}**. Will flag anything that needs fixing.",
        "On the code review for **{task}**. Checking SOLID principles and any potential security issues.",
    ],
}

_HANDOFF_MESSAGES: dict[str, dict[str, str]] = {
    "swarm_dispatcher": {
        "backend_dev":    "Routing **{task}** to @backend_dev — this is primarily a backend task.",
        "frontend_dev":   "Sending **{task}** to @frontend_dev — UI/component work needed.",
        "uiux_scout":     "Directing **{task}** to @uiux_scout — design spec should come first.",
        "uiux_researcher":"Kicking off **{task}** with @uiux_researcher for deep UX research.",
        "qa_engineer":    "Routing **{task}** straight to @qa_engineer — QA/testing task.",
        "code_reviewer":  "Sending **{task}** to @code_reviewer for a security and quality audit.",
    },
    "backend_dev": {
        "qa_engineer":    "Backend implementation for **{task}** is done. Handing off to @qa_engineer for review.",
    },
    "frontend_dev": {
        "qa_engineer":    "UI components for **{task}** are complete. Passing to @qa_engineer for quality check.",
        "uiux_scout":     "Need clarification on the design spec for **{task}**. Looping in @uiux_scout.",
    },
    "uiux_scout": {
        "frontend_dev":   "Design spec for **{task}** is ready. @frontend_dev, you're up — spec is in design-spec/spec.md.",
        "backend_dev":    "Design spec done for **{task}**. Routing to @backend_dev since API work is needed first.",
    },
    "uiux_researcher": {
        "frontend_dev":   "Research complete for **{task}**. Passing the design spec to @frontend_dev.",
    },
    "qa_engineer": {
        "backend_dev":    "Found critical issues in **{task}** that need fixing. Sending back to @backend_dev with the bug list.",
        "frontend_dev":   "UI issues found in **{task}**. @frontend_dev, please take another look at the review notes.",
    },
    "code_reviewer": {
        "backend_dev":    "Refactor required in **{task}** — sending back to @backend_dev with specific findings.",
        "frontend_dev":   "Frontend code in **{task}** needs work. Routing back to @frontend_dev.",
        "qa_engineer":    "Code review approved for **{task}**. Handing to @qa_engineer for final QA.",
    },
}

_COMPLETE_MESSAGES: dict[str, str] = {
    "qa_engineer":    "✅ **{task}** is cleared for completion. All tests pass, no critical issues found. Task done.",
    "code_reviewer":  "✅ Code review passed for **{task}**. Architecture and security checks: green.",
}


def _emit_chat(
    hive_id: str,
    agent_id: str,
    role: str,
    task_title: str,
    msg_type: str,  # "spawn" | "handoff" | "complete" | "custom"
    target_role: str = "",
    custom_text: str = "",
) -> None:
    """Emit a human-readable CHAT event visible in the Activity tab."""
    import random as _random
    text = ""
    if msg_type == "spawn":
        pool = _SPAWN_MESSAGES.get(role, ["Working on **{task}**..."])
        text = _random.choice(pool).format(task=task_title[:60])
    elif msg_type == "handoff":
        role_map = _HANDOFF_MESSAGES.get(role, {})
        template = role_map.get(target_role, f"Handing off **{{task}}** to @{target_role}.")
        text = template.format(task=task_title[:60])
    elif msg_type == "complete":
        template = _COMPLETE_MESSAGES.get(role, "✅ **{task}** completed.")
        text = template.format(task=task_title[:60])
    elif msg_type == "custom":
        text = custom_text
    if text:
        emit_event(
            "CHAT",
            hive_id=hive_id,
            agent_id=agent_id,
            data={"type": "chat", "role": role, "text": text, "display": role, "mentions": [], "code_ref": None, "is_inner": False},
            role=role,
        )


# ─── Action block parser for swarm transfer/terminate actions ─────────────────
_TRANSFER_RE = re.compile(
    r'"action"\s*:\s*"(transfer_to_\w+|terminate_and_report)"',
    re.IGNORECASE,
)


def _parse_swarm_action(response: str) -> tuple[str, str, str] | None:
    """
    Parse the terminal action block from a routine's LLM response.

    Returns (action_name, reason_or_output, raw_match) or None if not found.
    """
    actions = _extract_actions(response)
    for action in reversed(actions):  # last action block wins
        atype = action.get("action", "").lower()
        if atype.startswith("transfer_to_") or atype == "terminate_and_report":
            reason = action.get("reason", action.get("final_output", ""))
            return atype, reason, json.dumps(action)
    return None


# ─── Base Routine Execution Helper ────────────────────────────────────────────
async def _run_routine_llm(
    routine_role: str,
    system_prompt: str,
    user_prompt: str,
    ctx: SwarmContext,
    node: AgentNode,
) -> str:
    """
    Run an LLM call for a routine and emit THOUGHT events.

    Token optimizations applied here:
    - system_prompt is compressed (strips irrelevant skill sections for this role)
    - Pre-flight budget check aborts early if estimated cost exceeds budget_remaining
    - Token report is emitted as a log event for dashboard visibility

    Returns the raw LLM response text.
    """
    hive = ctx.hive
    if hive is None:
        raise RuntimeError("[Swarm] SwarmContext.hive is None — must be injected before calling routine")

    def emit(lvl: str, msg: str) -> None:
        hive.add_log(lvl, f"[{routine_role.upper()}] {msg}", agent_id=node.id)

    # ── Token Optimization: compress system prompt for this role ───────────────
    compressed_system = compress_system_prompt(routine_role, system_prompt)

    # ── Token Optimization: pre-flight budget check ────────────────────────────
    estimated_cost = estimate_call_cost(
        compressed_system, user_prompt, provider=hive.provider or "google"
    )
    if should_abort_for_budget(estimated_cost, ctx.budget_remaining):
        raise RuntimeError(
            f"[Swarm] Budget guard: estimated ${estimated_cost:.4f} exceeds "
            f"remaining ${ctx.budget_remaining:.4f} — aborting {routine_role}"
        )

    # ── Token report (visible in dashboard logs) ───────────────────────────────
    report = prompt_token_report(routine_role, system_prompt, user_prompt)
    emit(
        "info",
        f"📊 Tokens → sys:{report['system_tokens_compressed']} "
        f"(saved {report['system_savings_pct']}%) | "
        f"user:{report['user_tokens']} | "
        f"est_cost:${estimated_cost:.4f}",
    )

    agent = create_agent(
        provider=hive.provider,
        model=hive.model,
        log_emitter=emit,
    )
    agent.SYSTEM_PROMPT = compressed_system  # type: ignore[attr-defined]

    node.status = "working"
    emit_event(
        "STATUS", ctx.hive_id, node.id,
        {"status": "working", "role": routine_role},
        role=routine_role,
    )
    await db_upsert_agent(node.id, ctx.hive_id, routine_role, "working", None, ctx.task_title)

    # ── Streaming LLM call: emit THOUGHT tokens in real-time ──────────────────
    # Each chunk is pushed to the dashboard immediately as it arrives,
    # so users see the agent's reasoning live instead of waiting for full completion.
    response_chunks: list[str] = []
    current_line: list[str] = []

    try:
        async for chunk in agent.stream_think(user_prompt):
            if not chunk:
                continue
            response_chunks.append(chunk)
            current_line.append(chunk)

            # Emit THOUGHT when we hit a newline (keeps events meaningful, not per-char)
            combined = "".join(current_line)
            if "\n" in combined:
                lines = combined.split("\n")
                for line in lines[:-1]:
                    line = line.strip()
                    if line:
                        emit_event(
                            "THOUGHT", ctx.hive_id, node.id,
                            {"line": line, "streaming": True},
                            role=routine_role,
                        )
                # Keep remainder after last \n in the buffer
                current_line = [lines[-1]] if lines[-1] else []

        # Flush any remaining partial line
        if current_line:
            remainder = "".join(current_line).strip()
            if remainder:
                emit_event(
                    "THOUGHT", ctx.hive_id, node.id,
                    {"line": remainder, "streaming": True},
                    role=routine_role,
                )

    except Exception as stream_exc:
        # Streaming unavailable — fall back to blocking invoke
        emit("warning", f"⚠️ Streaming failed ({stream_exc!s:.80}), falling back to blocking call…")
        response_chunks = []
        fallback = await agent.think(user_prompt)
        response_chunks = [fallback]
        for line in fallback.split("\n"):
            line = line.strip()
            if line:
                emit_event("THOUGHT", ctx.hive_id, node.id, {"line": line}, role=routine_role)

    response = "".join(response_chunks)
    _accumulate_chars(ctx.hive_id, response)
    return response


async def _execute_file_and_shell_actions(
    actions: list[dict],
    ctx: SwarmContext,
    node: AgentNode,
) -> None:
    """Execute write_file, mkdir, and execute_command actions produced by a routine."""
    hive = ctx.hive
    if hive is None:
        return

    def emit(lvl: str, msg: str) -> None:
        hive.add_log(lvl, f"[{node.role.upper()}] {msg}", agent_id=node.id)

    fs = EventedFileSystemTool(ctx.session_dir, emit, ctx.hive_id, node.id, role=node.role)
    terminal = EventedTerminalTool(ctx.session_dir, emit, ctx.hive_id, node.id, role=node.role)

    for action in actions:
        if _is_killed(ctx.hive_id):
            break
        atype = action.get("action", "").lower()
        if atype == "write_file":
            fs.write_file(action.get("path", "output.txt"), action.get("content", ""))
        elif atype == "mkdir":
            fs.mkdir(action.get("path", "."))
        elif atype == "execute_command":
            await terminal.execute_async(
                command=action.get("command", "echo done"),
                cwd=action.get("cwd"),
                timeout=action.get("timeout", 120),
            )
        elif atype == "publish_artifact":
            topic = action.get("topic", "artifact")
            payload = action.get("payload", {})
            hive.message_bus.publish(topic, payload)
            emit_event(
                "ARTIFACT", ctx.hive_id, node.id,
                {"topic": topic, "payload": payload},
                role=node.role,
            )


def _make_agent_node(role: str, ctx: SwarmContext) -> AgentNode:
    """Create and register an AgentNode for a routine execution."""
    node = AgentNode(
        id=str(uuid.uuid4()),
        role=role,
        session_id=ctx.hive_id,
        parent_id=None,
        status="thinking",
        specialized_task=ctx.task_title,
    )
    if ctx.hive:
        ctx.hive.register_agent(node)
    emit_event(
        "SPAWN", ctx.hive_id, node.id,
        {"role": role, "task_preview": ctx.task_title[:120]},
        role=role,
    )
    emit_event(
        "STATUS", ctx.hive_id, node.id,
        {"status": "thinking", "role": role},
        role=role,
    )
    return node


async def _finish_node(node: AgentNode, ctx: SwarmContext, status: str = "completed") -> None:
    """Mark an agent node as completed/errored in DB and emit STATUS event."""
    node.status = status
    node.completed_at = datetime.utcnow().isoformat()
    emit_event(
        "STATUS", ctx.hive_id, node.id,
        {"status": status, "role": node.role},
        role=node.role,
    )
    emit_event("DONE", ctx.hive_id, node.id, {"role": node.role}, role=node.role)
    await db_upsert_agent(node.id, ctx.hive_id, node.role, status, None, ctx.task_title)


# ─── Max revision guard ───────────────────────────────────────────────────────
# If QA Engineer sends a task back to a specialist more than this many times, it
# must terminate — preventing infinite QA Engineer ↔ Specialist loops.
_MAX_REVISIONS: int = 2


def _revision_count(ctx: "SwarmContext") -> int:
    """Count how many times QA Engineer has appeared in the handoff chain."""
    return ctx.handoff_chain.count("qa_engineer")


# ─── Swarm Dispatcher Routine ─────────────────────────────────────────────────
_DISPATCHER_PROMPT = """\
You are the Swarm Dispatcher — the autonomous entry point for the AgentHive Swarm.

Your sole job is to analyze an incoming task and immediately hand it off to the
most appropriate specialist routine. You do NOT implement anything yourself.

## Routing Logic
- Task involves deep UX research, personas, design systems → transfer_to_uiux_researcher
- Task involves UI design, wireframes, color palettes, user flows → transfer_to_uiux_scout
- Task involves API endpoints, database, business logic, server code → transfer_to_backend_dev
- Task involves React/Next.js components, pages, frontend code → transfer_to_frontend_dev
- Task involves testing, QA, code review, bug fixing → transfer_to_qa_engineer
- Task involves code quality review, security audit → transfer_to_code_reviewer
- Full-stack / ambiguous: default to transfer_to_backend_dev (backend first)

## Output Format
Analyze the task, then emit exactly ONE action block:
```action
{"action": "transfer_to_<role>", "reason": "<concise justification>"}
```
""".strip()


class SwarmDispatcherRoutine(SwarmRoutine):
    """Entry-point dispatcher that routes tasks to specialist routines."""

    role = "swarm_dispatcher"
    system_prompt = _DISPATCHER_PROMPT
    available_transfers = ["uiux_scout", "backend_dev", "frontend_dev", "qa_engineer", "planner"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        # ── Fast-path: skip LLM call if task keywords are unambiguous ─────────
        fast_role = fast_path_dispatch(ctx.task_title, ctx.task_description or "")
        if fast_role:
            updated_ctx = ctx.append_history(
                self.role, f"Fast-path routed to {fast_role} (no LLM call)"
            )
            logger.info("[SwarmDispatcher] Fast-path → %s (saved LLM call)", fast_role)
            # Emit human-readable dispatch chat message
            _emit_chat(ctx.hive_id, "system", self.role, ctx.task_title, "handoff", target_role=fast_role)
            if fast_role == "uiux_scout":
                return transfer_to_uiux_scout(updated_ctx, "Fast-path: UI/design keywords")
            if fast_role == "frontend_dev":
                return transfer_to_frontend_dev(updated_ctx, "Fast-path: frontend keywords")
            if fast_role == "qa_engineer":
                return transfer_to_qa_engineer(updated_ctx, "Fast-path: QA/test keywords")
            return transfer_to_backend_dev(updated_ctx, "Fast-path: backend keywords")

        # ── Fallback: LLM-based routing for ambiguous tasks ───────────────────
        node = _make_agent_node(self.role, ctx)
        context_block = build_smart_context_block(
            self.role,
            ctx.handoff_chain,
            ctx.artifact_bus,
            ctx.context_variables,
            ctx.history,
        )

        prior_context_section = f"## Prior Context\n{context_block}" if context_block else ""
        handoff_instructions = self._build_handoff_instructions()

        user_prompt = f"""
## Task to Route
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{prior_context_section}

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if a.get("action") not in ("transfer_to_uiux_scout",
                 "transfer_to_backend_dev", "transfer_to_frontend_dev", "transfer_to_qa_engineer")],
                ctx, node,
            )

            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                updated_ctx = ctx.append_history(
                    self.role, f"LLM-routed to {action_name}: {reason}"
                )
                target = action_name.replace("transfer_to_", "")
                _emit_chat(ctx.hive_id, "system", self.role, ctx.task_title, "handoff", target_role=target)
                if action_name == "transfer_to_uiux_scout":
                    return transfer_to_uiux_scout(updated_ctx, reason)
                if action_name == "transfer_to_uiux_researcher":
                    return transfer_to_uiux_researcher(updated_ctx, reason)
                if action_name == "transfer_to_frontend_dev":
                    return transfer_to_frontend_dev(updated_ctx, reason)
                if action_name == "transfer_to_code_reviewer":
                    return transfer_to_code_reviewer(updated_ctx, reason)
                if action_name == "transfer_to_qa_engineer":
                    return transfer_to_qa_engineer(updated_ctx, reason)
                if action_name == "transfer_to_planner":
                    return Transfer(target_routine="planner", context=updated_ctx, reason=reason)
                return transfer_to_backend_dev(updated_ctx, reason)

            # Last resort keyword fallback (no LLM action parsed)
            updated_ctx = ctx.append_history(self.role, "Dispatched via keyword fallback")
            text = (ctx.task_title + " " + (ctx.task_description or "")).lower()
            if any(k in text for k in ["ui", "frontend", "react", "component", "design", "css"]):
                return transfer_to_frontend_dev(updated_ctx, "Frontend keywords detected")
            if any(k in text for k in ["full-stack", "fullstack", "full stack", "platform", "system", "app"]):
                return Transfer(target_routine="planner", context=updated_ctx, reason="Complex task — delegating to Planner")
            return transfer_to_backend_dev(updated_ctx, "Default to backend specialist")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[SwarmDispatcher] Error: %s", exc)
            return transfer_to_backend_dev(ctx, f"Dispatcher error fallback: {exc}")


# ─── UI/UX Scout Routine ──────────────────────────────────────────────────────
_UIUX_SCOUT_PROMPT = """\
You are the UI/UX Scout — a design-first autonomous agent.

Your mission: produce a comprehensive Design Spec and hand off to Frontend Developer.

## Skill DNA
- Design Thinking: Visual hierarchy, color palettes, typography, spacing grids
- User Research: Identify persona, flows, interaction patterns
- Accessibility: WCAG AA minimum, ARIA roles, keyboard navigation
- Mobile-first: Every component works at 320px viewport

## Mandatory Output — you MUST emit these action blocks:

Step 1 — Write the Design Spec file:
```action
{"action": "write_file", "path": "design-spec/spec.md", "content": "# Design Spec\n...full spec content..."}
```

Step 2 — Publish the artifact:
```action
{"action": "publish_artifact", "topic": "design_spec", "payload": {"spec_path": "design-spec/spec.md", "summary": "<one-sentence summary>"}}
```

Step 3 — Hand off:
```action
{"action": "transfer_to_frontend_dev", "reason": "Design spec complete"}
```

CRITICAL: You MUST write the file. Do not skip the write_file action block.
""".strip()


class UiUxScoutRoutine(SwarmRoutine):
    """Design-thinking specialist. Produces Design Specs and hands off to Frontend Developer."""

    role = "uiux_scout"
    system_prompt = _UIUX_SCOUT_PROMPT
    available_transfers = ["frontend_dev", "backend_dev"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")
        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )

        prior_context_section = f"## Prior Context\n{context_block}" if context_block else ""
        handoff_instructions = self._build_handoff_instructions()

        user_prompt = f"""
## Design Research Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{prior_context_section}

Research UX patterns for this task. Write `design-spec/spec.md` with:
- Color palette (hex codes), typography, spacing system
- Component inventory, UX flow, interaction patterns
- Accessibility requirements

Then publish with:
```action
{{"action": "publish_artifact", "topic": "design_spec", "payload": {{"spec_path": "design-spec/spec.md", "summary": "<one-sentence summary>"}}}}
```

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "") and a.get("action") != "terminate_and_report"],
                ctx, node,
            )

            # Capture design spec into context variables
            updated_ctx = ctx.append_history(self.role, "Design spec generated and published")
            for action in actions:
                if action.get("action") == "publish_artifact" and action.get("topic") == "design_spec":
                    updated_ctx = updated_ctx.with_variable("design_spec", action.get("payload", {}))

            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "transfer_to_backend_dev":
                    return transfer_to_backend_dev(updated_ctx, reason)
            return transfer_to_frontend_dev(updated_ctx, "Design spec complete — ready for Frontend Developer")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[UiUxScout] Error: %s", exc)
            return transfer_to_frontend_dev(ctx, f"UX Scout error fallback: {exc}")


# ─── Backend Developer Routine ─────────────────────────────────────────────────────
_LOGIC_WEAVER_PROMPT = """\
You are the Backend Developer — a backend specialist following Clean Architecture and SOLID principles.

## Skill DNA
- API Design: RESTful resources, consistent envelopes, HTTP status codes, versioning
- Clean Architecture: entities/ → use_cases/ → controllers/ → gateways/
- Backend Patterns: Repository pattern, Service layer, Dependency injection
- TDD-lite: Write at least one test per endpoint

## Rules
- NEVER expose raw DB IDs — use UUIDs
- ALL inputs validated at controller boundary (Pydantic or zod)
- Structured logging with correlation-id on every request
- No function longer than 50 lines

## Mandatory Output — you MUST emit write_file action blocks for EVERY file:
```action
{"action": "write_file", "path": "<relative path>", "content": "<full file content>"}
```

Write ALL source files (not just a summary). Then hand off:
```action
{"action": "transfer_to_qa_engineer", "reason": "Backend implementation complete"}
```

CRITICAL: Do NOT describe code in text — write actual files. Every file must have real, working code.
""".strip()


class BackendDevRoutine(SwarmRoutine):
    """Backend specialist: API, database, Clean Architecture. Hands off to QA Engineer."""

    role = "backend_dev"
    system_prompt = _LOGIC_WEAVER_PROMPT
    available_transfers = ["qa_engineer", "devops_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")
        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )

        shared_context_section = f"## Shared Context\n{context_block}" if context_block else ""
        handoff_instructions = self._build_handoff_instructions()

        user_prompt = f"""
## Backend Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{shared_context_section}

Build a complete backend implementation. You MUST write actual source files using write_file action blocks.
Do NOT describe what you will do — just do it by writing files.

Required structure (adjust based on task):
- Main entry point (e.g. `src/main.py` or `src/index.ts`)
- At least one route/controller file
- Any model, service, or utility files needed
- A basic test in `tests/`

Write EVERY file with its complete content. After all files are written, emit:
```action
{{"action": "transfer_to_qa_engineer", "reason": "Backend implementation complete"}}
```

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "") and a.get("action") != "terminate_and_report"],
                ctx, node,
            )

            # Capture api_spec if published
            updated_ctx = ctx.append_history(self.role, "Backend implementation complete")
            for action in actions:
                if action.get("action") == "publish_artifact" and action.get("topic") == "api_spec":
                    updated_ctx = updated_ctx.with_variable("api_spec", action.get("payload", {}))

            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "transfer_to_devops_engineer":
                    return Transfer(target_routine="devops_engineer", context=updated_ctx, reason=reason)
            return transfer_to_qa_engineer(updated_ctx, "Backend work complete — handing to QA Engineer for QA")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[BackendDev] Error: %s", exc)
            return transfer_to_qa_engineer(ctx, f"Backend Developer error fallback: {exc}")


# ─── Frontend Developer Routine ────────────────────────────────────────────────────
_PIXEL_CRAFTER_PROMPT = """\
You are the Frontend Developer — a frontend specialist in React/Next.js and Atomic Design.

## Skill DNA
- Atomic Design: atoms/ → molecules/ → organisms/ → pages/
- React Best Practices: Server Components by default, "use client" only when needed
- TypeScript: zero `any`, discriminated unions, branded types
- Accessibility: semantic HTML, ARIA attributes, keyboard navigation

## Rules
- Read the design_spec context variable if available — follow it precisely
- Read the api_spec context variable if available — integrate with it
- Every component has a unique `id` attribute
- No component longer than 150 lines — split into atoms/molecules

## Mandatory Output — you MUST emit write_file action blocks for EVERY component and page file:
```action
{"action": "write_file", "path": "<relative path e.g. src/components/atoms/Button.tsx>", "content": "<full TypeScript/TSX file content>"}
```

Write ALL component files with real, compilable TypeScript code. Then hand off:
```action
{"action": "transfer_to_qa_engineer", "reason": "Frontend implementation complete"}
```

CRITICAL: Do NOT describe components in text — write actual .tsx/.ts files. Every file must contain real working code.
""".strip()


class FrontendDevRoutine(SwarmRoutine):
    """Frontend specialist: React/Next.js + Atomic Design. Hands off to UiUxScout or QA Engineer."""

    role = "frontend_dev"
    system_prompt = _PIXEL_CRAFTER_PROMPT
    available_transfers = ["uiux_scout", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")
        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )

        design_spec = ctx.context_variables.get("design_spec", {})
        api_spec = ctx.context_variables.get("api_spec", {})

        design_spec_section = f"## Design Spec Available\n{json.dumps(design_spec, indent=2)[:600]}" if design_spec else ""
        api_spec_section = f"## API Spec Available\n{json.dumps(api_spec, indent=2)[:400]}" if api_spec else ""
        shared_context_section = f"## Shared Context\n{context_block}" if context_block else ""
        handoff_instructions = self._build_handoff_instructions()

        user_prompt = f"""
## Frontend Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{design_spec_section}
{api_spec_section}
{shared_context_section}

Build a complete frontend implementation. You MUST write actual source files using write_file action blocks.
Do NOT describe what you will do — just do it by writing files.

Required structure:
- `src/app/page.tsx` or equivalent main page
- Component files in `src/components/` (atoms, molecules, organisms as needed)
- Any types, utilities, or hooks needed

Write EVERY file with its complete TypeScript/TSX content. After all files are written, emit:
```action
{{"action": "transfer_to_qa_engineer", "reason": "Frontend implementation complete"}}
```

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "") and a.get("action") != "terminate_and_report"],
                ctx, node,
            )

            updated_ctx = ctx.append_history(self.role, "Frontend implementation complete")
            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "transfer_to_uiux_scout":
                    return transfer_to_uiux_scout(updated_ctx, reason)
            return transfer_to_qa_engineer(updated_ctx, "Frontend work complete — handing to QA Engineer for QA")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[FrontendDev] Error: %s", exc)
            return transfer_to_qa_engineer(ctx, f"Frontend Developer error fallback: {exc}")


# ─── QA Engineer Routine ─────────────────────────────────────────────────────────
_GUARDIAN_PROMPT = """\
You are the QA Engineer — the QA and code review specialist.

## Skill DNA
- Systematic Debugging: Root cause first, NO fixes without investigation
- Code Review: Critical (security, XSS, injection) → Important → Minor

## Decision Tree
1. List workspace files
2. If NO source files exist yet: immediately terminate_and_report stating "No implementation found"
3. If source files DO exist: review the code
4. Write a brief test to tests/ — only if source files exist
5. Run the test
6a. Tests PASS and no Critical issues → terminate_and_report with full summary
6b. Critical bugs OR tests FAIL → transfer back to the developer ONE TIME ONLY

## CRITICAL TERMINATION RULES
- You are the ONLY agent who can call terminate_and_report
- If you have already sent the task back once → you MUST terminate_and_report (do not loop again)
- If no files were written → terminate_and_report immediately with message about empty workspace
""".strip()


class QaEngineerRoutine(SwarmRoutine):
    """QA + code review specialist. Either terminates the swarm or routes back to developers."""

    role = "qa_engineer"
    system_prompt = _GUARDIAN_PROMPT
    available_transfers = ["backend_dev", "frontend_dev"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")
        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )

        # ── Revision guard — prevent infinite loops ────────────────────────────
        revisions = _revision_count(ctx)
        if revisions >= _MAX_REVISIONS:
            await _finish_node(node, ctx)
            logger.warning(
                "[QA Engineer] MAX_REVISIONS (%d) reached for task=%s — force terminating",
                _MAX_REVISIONS, ctx.task_id[:8]
            )
            return terminate_and_report(
                ctx.append_history(self.role, f"Force-terminated after {revisions} revision cycles"),
                f"Task '{ctx.task_title}' completed after {revisions} QA Engineer review cycles. "
                f"Handoff chain: {' -> '.join(ctx.handoff_chain)}"
            )

        # Determine which developer to route back to if bugs found
        last_worker = ctx.last_worker_role or "backend_dev"
        if "frontend_dev" in ctx.handoff_chain or "frontend_dev" in last_worker:
            default_back_role = "frontend_dev"
        else:
            default_back_role = "backend_dev"

        # ── List workspace files to give QA Engineer real context ─────────────────
        from app.hive import EventedFileSystemTool
        def noop_emit(lvl: str, msg: str) -> None:
            pass
        fs_check = EventedFileSystemTool(ctx.session_dir, noop_emit, ctx.hive_id, node.id, role=self.role)
        dir_result = fs_check.read_dir(".")
        workspace_files = [e["name"] for e in dir_result.get("entries", []) if not e.get("is_dir", False)]
        workspace_summary = ", ".join(workspace_files[:20]) if workspace_files else "(empty — no files written yet)"

        shared_context_section = f"## Shared Context\n{context_block}" if context_block else ""
        handoff_chain_str = " -> ".join(ctx.handoff_chain)
        handoff_instructions = self._build_handoff_instructions()

        # Build the revision-aware instruction
        revision_note = (
            f"\n**NOTE:** You have already reviewed this task {revisions} time(s). "
            f"This is revision {revisions + 1} of {_MAX_REVISIONS} allowed. "
            + ("You MUST terminate_and_report now — no more transfers allowed." if revisions + 1 >= _MAX_REVISIONS else "")
        )

        user_prompt = f"""
## QA Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{shared_context_section}

Hand-off chain so far: {handoff_chain_str}
Workspace files: {workspace_summary}
{revision_note}

## Instructions
1. If workspace is empty (no source files) → immediately terminate_and_report
2. Otherwise review the source files
3. Write ONE test file to `tests/` and run it
4. Decision:
   - All good OR revision limit reached → terminate_and_report with full summary
   - Critical bugs found AND revisions < {_MAX_REVISIONS} → transfer to {default_back_role} with specific bug list

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "") and a.get("action") != "terminate_and_report"],
                ctx, node,
            )

            updated_ctx = ctx.append_history(self.role, f"QA Engineer QA review complete (revision {revisions + 1})")
            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "terminate_and_report":
                    _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "complete")
                    return terminate_and_report(updated_ctx, reason or f"Task completed: {ctx.task_title}")
                # Only allow transfer-back if we haven't hit the revision limit
                if revisions + 1 < _MAX_REVISIONS:
                    if action_name == "transfer_to_backend_dev":
                        return transfer_to_backend_dev(updated_ctx, reason)
                    if action_name == "transfer_to_frontend_dev":
                        return transfer_to_frontend_dev(updated_ctx, reason)
                else:
                    # Revision limit reached — force terminate regardless of LLM decision
                    logger.warning("[QA Engineer] Revision limit reached — overriding transfer with terminate")
                    return terminate_and_report(
                        updated_ctx,
                        f"Terminated after max revisions ({_MAX_REVISIONS}): {ctx.task_title}. "
                        f"Last review note: {reason[:200]}"
                    )

            # Default: auto-terminate if no explicit action (QA considered it done)
            return terminate_and_report(updated_ctx, f"QA complete for: {ctx.task_title}")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[QA Engineer] Error: %s", exc)
            return terminate_and_report(ctx, f"QA completed with errors: {exc}")


# ─── UI/UX Researcher Routine ────────────────────────────────────────────────
_UIUX_RESEARCHER_PROMPT = """\
You are the UI/UX Researcher — a deep design-thinking specialist.

## Skill DNA
- User Research: Personas, journey maps, pain points
- Design Systems: Color, typography, spacing, component inventory
- Accessibility: WCAG AA, ARIA, contrast ratios

## Mandatory Output
You MUST produce a design spec file using a write_file action:
```action
{"action": "write_file", "path": "design-spec/spec.md", "content": "# Design Spec\\n..."}
```

Then publish:
```action
{"action": "publish_artifact", "topic": "design_spec", "payload": {"spec_path": "design-spec/spec.md", "summary": "..."}}
```

Then hand off:
```action
{"action": "transfer_to_frontend_dev", "reason": "Design spec ready"}
```

CRITICAL: Always write the actual spec file before handing off.
""".strip()


class UiUxResearcherRoutine(SwarmRoutine):
    """Deep design research. Produces a Design Spec then hands off to Frontend Developer."""

    role = "uiux_researcher"
    system_prompt = _UIUX_RESEARCHER_PROMPT
    available_transfers = ["frontend_dev", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        from app.swarm.handoffs import transfer_to_frontend_dev as _tpc
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")
        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )
        shared = f"## Context\n{context_block}" if context_block else ""
        handoff_instructions = self._build_handoff_instructions()

        user_prompt = f"""
## Design Research Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{shared}

Produce a comprehensive design spec. Write the file, publish the artifact, then hand off to frontend_dev.

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(self.role, self.system_prompt, user_prompt, ctx, node)
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "") and a.get("action") != "terminate_and_report"],
                ctx, node,
            )

            updated_ctx = ctx.append_history(self.role, "UI/UX Research complete")
            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "transfer_to_frontend_dev":
                    return transfer_to_frontend_dev(updated_ctx, reason)
                if action_name == "transfer_to_qa_engineer":
                    return transfer_to_qa_engineer(updated_ctx, reason)

            return transfer_to_frontend_dev(updated_ctx, "Design research complete — handing to Frontend Developer")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[UiUxResearcher] Error: %s", exc)
            return transfer_to_frontend_dev(ctx, f"Researcher errored: {exc}")


# ─── Code Reviewer Routine ────────────────────────────────────────────────────
_CODE_REVIEWER_PROMPT = """\
You are the Code Reviewer — a rigorous quality gatekeeper following Clean Code principles.

## Skill DNA
- Security: XSS, SQL injection, secret leaks, broken auth
- Architecture: SOLID, separation of concerns, no god-objects
- Readability: naming, complexity, dead code, missing docs

## Review Levels
- CRITICAL (block): Security vulnerabilities, broken imports, data loss risks
- IMPORTANT (fix): Functions >50 lines, no error handling, magic strings
- MINOR (note): Missing docstrings, dead code, inconsistent naming

## Process
1. List workspace files
2. Read each source file
3. Write review report to `review-logs/review.md`
4. Publish verdict:
```action
{"action": "publish_artifact", "topic": "code_review", "payload": {"verdict": "APPROVED|REFACTOR_REQUIRED", "critical": 0, "important": 0, "minor": 0, "summary": "..."}}
```
5. If APPROVED → transfer_to_qa_engineer
   If REFACTOR_REQUIRED → transfer back to the appropriate developer

CRITICAL: Write the review file before any transfer.
""".strip()


class CodeReviewerRoutine(SwarmRoutine):
    """Code review specialist. Approves or routes back to the developer."""

    role = "code_reviewer"
    system_prompt = _CODE_REVIEWER_PROMPT
    available_transfers = ["backend_dev", "frontend_dev", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")
        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )
        shared = f"## Context\n{context_block}" if context_block else ""

        # Determine which dev to route back to
        back_role = "frontend_dev" if "frontend_dev" in ctx.handoff_chain else "backend_dev"
        handoff_instructions = self._build_handoff_instructions()

        user_prompt = f"""
## Code Review Task
**Title:** {ctx.task_title}

{shared}

Review all source files. Write `review-logs/review.md`. Publish the verdict artifact.
If APPROVED → transfer_to_qa_engineer.
If REFACTOR_REQUIRED → transfer_to_{back_role} with a clear bug list.

{handoff_instructions}
""".strip()

        try:
            response = await _run_routine_llm(self.role, self.system_prompt, user_prompt, ctx, node)
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "") and a.get("action") != "terminate_and_report"],
                ctx, node,
            )

            updated_ctx = ctx.append_history(self.role, "Code review complete")
            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "transfer_to_qa_engineer":
                    return transfer_to_qa_engineer(updated_ctx, reason)
                if action_name == "transfer_to_backend_dev":
                    return transfer_to_backend_dev(updated_ctx, reason)
                if action_name == "transfer_to_frontend_dev":
                    return transfer_to_frontend_dev(updated_ctx, reason)

            # Default: approved → qa_engineer
            return transfer_to_qa_engineer(updated_ctx, "Code review approved")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[CodeReviewer] Error: %s", exc)
            return transfer_to_qa_engineer(ctx, f"Review errored: {exc}")


# ─── Planner Routine ────────────────────────────────────────────────────────────
_PLANNER_PROMPT = """\
You are the Swarm Planner — you decompose complex tasks into parallel sub-tasks.

Your job:
1. Analyse the task complexity
2. If the task is simple (1 focus area) → route to one specialist directly
3. If the task is complex (multiple independent parts) → decompose into 2–4 parallel sub-tasks

## Available specialists
- backend_dev: API endpoints, database models, business logic, server code
- frontend_dev: React/Next.js pages, components, UI code
- uiux_scout: design specs, color palette, typography, UX flows

## For a SIMPLE task, emit ONE transfer:
```action
{"action": "transfer_to_<role>", "reason": "<why>"}
```

## For a COMPLEX task, emit ONE decompose block:
```action
{
  "action": "decompose_parallel",
  "reason": "<why parallel>",
  "branches": [
    {"target": "backend_dev", "sub_task": "<specific sub-task description>"},
    {"target": "frontend_dev", "sub_task": "<specific sub-task description>"}
  ]
}
```

CRITICAL: Each sub_task must be fully self-contained and independent.
Do NOT create branches that depend on each other's output.
""".strip()


class PlannerRoutine(SwarmRoutine):
    """
    Decomposes complex tasks into parallel branches (ParallelTransfer)
    or routes simple tasks directly to a single specialist (Transfer).
    """

    role = "planner"
    system_prompt = _PLANNER_PROMPT
    available_transfers = ["backend_dev", "frontend_dev", "uiux_scout", "result_merger"]

    async def run(self, ctx: SwarmContext) -> "Transfer | ParallelTransfer | str":
        import uuid as _uuid
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")

        context_block = build_smart_context_block(
            self.role, ctx.handoff_chain, ctx.artifact_bus,
            ctx.context_variables, ctx.history,
        )
        prior = f"## Prior Context\n{context_block}" if context_block else ""

        user_prompt = f"""## Task to Decompose
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{prior}

Decide: is this a simple single-focus task or a complex multi-part task?
Output ONE action block (transfer_to_<role> OR decompose_parallel).
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            await _finish_node(node, ctx)

            for action in actions:
                atype = action.get("action", "").lower()

                # Parallel decomposition
                if atype == "decompose_parallel":
                    branches_raw = action.get("branches", [])
                    if not branches_raw or len(branches_raw) < 2:
                        # Malformed — fall through to single route
                        break

                    branches = []
                    for b in branches_raw:
                        target = b.get("target", "backend_dev")
                        sub_task = b.get("sub_task", ctx.task_description or ctx.task_title)
                        branch_ctx = SwarmContext(
                            hive_id=ctx.hive_id,
                            task_id=ctx.task_id,
                            task_title=f"[Parallel] {ctx.task_title}",
                            task_description=sub_task,
                            history=list(ctx.history),
                            context_variables=dict(ctx.context_variables),
                            artifact_bus=dict(ctx.artifact_bus),
                            current_agent_role=target,
                            handoff_chain=list(ctx.handoff_chain),
                            session_dir=ctx.session_dir,
                            budget_remaining=ctx.budget_remaining / max(len(branches_raw), 1),
                            hive=ctx.hive,
                            parallel_depth=ctx.parallel_depth + 1,
                        )
                        branches.append(ParallelBranch(
                            branch_id=str(_uuid.uuid4()),
                            target_routine=target,
                            context=branch_ctx,
                            reason=f"Parallel branch: {sub_task[:80]}",
                        ))

                    updated_ctx = ctx.append_history(
                        self.role,
                        f"Decomposed into {len(branches)} parallel branches: "
                        + ", ".join(b.target_routine for b in branches)
                    )
                    _emit_chat(
                        ctx.hive_id, node.id, self.role, ctx.task_title,
                        "custom",
                        custom_text=f"🔀 Splitting **{ctx.task_title}** into {len(branches)} parallel branches: "
                                    + ", ".join(f"@{b.target_routine}" for b in branches),
                    )
                    return ParallelTransfer(
                        branches=branches,
                        merge_routine="result_merger",
                        context=updated_ctx,
                        reason=action.get("reason", "Parallel decomposition"),
                    )

                # Sequential single-specialist route
                if atype.startswith("transfer_to_"):
                    target_role = atype.replace("transfer_to_", "")
                    updated_ctx = ctx.append_history(self.role, f"Simple task — routing to {target_role}")
                    _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "handoff", target_role=target_role)
                    return Transfer(target_routine=target_role, context=updated_ctx, reason=f"Single specialist: {target_role}")

            # Fallback: keyword route
            updated_ctx = ctx.append_history(self.role, "Keyword fallback routing")
            text = (ctx.task_title + " " + (ctx.task_description or "")).lower()
            if any(k in text for k in ["ui", "frontend", "react", "component", "css", "design"]):
                return Transfer(target_routine="frontend_dev", context=updated_ctx, reason="Frontend keywords")
            return Transfer(target_routine="backend_dev", context=updated_ctx, reason="Default backend")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[Planner] Error: %s", exc)
            return Transfer(target_routine="backend_dev", context=ctx, reason=f"Planner error fallback: {exc}")


# ─── Result Merger Routine ──────────────────────────────────────────────────────
_MERGER_PROMPT = """\
You are the Result Merger — you synthesize outputs from multiple parallel branches.

You receive a list of branch_results in context_variables["branch_results"].
Each result has: role, sub_task completed, and output summary.

Your job:
1. Write a unified `SUMMARY.md` combining all branch outputs
2. Note any integration points (e.g. API endpoint ↔ frontend contract)
3. Hand off to QA Engineer for final validation

Mandatory:
```action
{"action": "write_file", "path": "SUMMARY.md", "content": "# Parallel Execution Summary\\n..."}
```
Then:
```action
{"action": "transfer_to_qa_engineer", "reason": "All parallel branches complete, ready for QA"}
```
""".strip()


class ResultMergerRoutine(SwarmRoutine):
    """
    Fan-in routine. Receives merged context from all parallel branches,
    synthesizes a unified summary, then routes to QA Engineer.
    """

    role = "result_merger"
    system_prompt = _MERGER_PROMPT
    available_transfers = ["qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(
            ctx.hive_id, node.id, self.role, ctx.task_title,
            "custom",
            custom_text=f"✅ All parallel branches complete for **{ctx.task_title}**. Merging results…",
        )

        branch_results = ctx.context_variables.get("branch_results", [])
        results_summary = json.dumps(branch_results, indent=2)[:2000]

        user_prompt = f"""## Merge Task
**Title:** {ctx.task_title}

## Branch Results (from parallel execution)
```json
{results_summary}
```

Write SUMMARY.md synthesizing all results, then transfer to qa_engineer.
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            await _execute_file_and_shell_actions(
                [a for a in actions if "transfer_to" not in a.get("action", "")],
                ctx, node,
            )
            updated_ctx = ctx.append_history(self.role, "Branch results merged into SUMMARY.md")
            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "terminate_and_report":
                    return terminate_and_report(updated_ctx, reason or f"Merged: {ctx.task_title}")

            return transfer_to_qa_engineer(updated_ctx, "Parallel branches merged — handing to QA")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[ResultMerger] Error: %s", exc)
            return transfer_to_qa_engineer(ctx, f"Merger error: {exc}")


# ─── Build Default Swarm ──────────────────────────────────────────────────────────
def build_default_swarm() -> list[SwarmRoutine]:
    """Return the full set of routines for the AgentHive Swarm."""
    return [
        SwarmDispatcherRoutine(),
        PlannerRoutine(),
        UiUxScoutRoutine(),
        UiUxResearcherRoutine(),
        BackendDevRoutine(),
        FrontendDevRoutine(),
        CodeReviewerRoutine(),
        QaEngineerRoutine(),
        ResultMergerRoutine(),
    ]
