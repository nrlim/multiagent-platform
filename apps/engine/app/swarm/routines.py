"""
AgentHive Swarm Engine - Specialist Routines

Five autonomous routines with "Skill DNA":
  - SwarmDispatcherRoutine: entry point, reads task and routes to the right specialist
  - UiUxScout: design research, produces Design Spec, hands off to Pixel Crafter
  - LogicWeaver: backend API + Clean Architecture, hands off to Guardian or DevOps
  - PixelCrafter: React/Next.js + Atomic Design, hands off to UiUxScout or Guardian
  - Guardian: QA + code review, routes back to developer on bugs or calls terminate_and_report
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from app.agents.factory import create_agent
from app.agents.prompts import get_system_prompt
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
from app.swarm.core import SwarmContext, SwarmRoutine, Transfer
from app.swarm.handoffs import (
    terminate_and_report,
    transfer_to_dispatcher,
    transfer_to_guardian,
    transfer_to_logic_weaver,
    transfer_to_pixel_crafter,
    transfer_to_uiux_scout,
)

logger = logging.getLogger(__name__)

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
    Returns the raw LLM response text.
    """
    hive = ctx.hive
    if hive is None:
        raise RuntimeError("[Swarm] SwarmContext.hive is None — must be injected before calling routine")

    def emit(lvl: str, msg: str) -> None:
        hive.add_log(lvl, f"[{routine_role.upper()}] {msg}", agent_id=node.id)

    agent = create_agent(
        provider=hive.provider,
        model=hive.model,
        log_emitter=emit,
    )
    agent.SYSTEM_PROMPT = system_prompt  # type: ignore[attr-defined]

    node.status = "working"
    emit_event(
        "STATUS", ctx.hive_id, node.id,
        {"status": "working", "role": routine_role},
        role=routine_role,
    )
    await db_upsert_agent(node.id, ctx.hive_id, routine_role, "working", None, ctx.task_title)

    response = await agent.think(user_prompt)
    _accumulate_chars(ctx.hive_id, response)

    for line in response.split("\n"):
        line = line.strip()
        if line:
            emit_event("THOUGHT", ctx.hive_id, node.id, {"line": line}, role=routine_role)

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


# ─── Swarm Dispatcher Routine ─────────────────────────────────────────────────
_DISPATCHER_PROMPT = """\
You are the Swarm Dispatcher — the autonomous entry point for the AgentHive Swarm.

Your sole job is to analyze an incoming task and immediately hand it off to the
most appropriate specialist routine. You do NOT implement anything yourself.

## Routing Logic
- Task involves UI design, wireframes, color palettes, user flows → transfer_to_uiux_scout
- Task involves API endpoints, database, business logic, server code → transfer_to_logic_weaver
- Task involves React components, Next.js pages, frontend styling → transfer_to_pixel_crafter
- Task involves testing, QA, code review, bug fixing → transfer_to_guardian
- Ambiguous: default to transfer_to_logic_weaver

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
    available_transfers = ["uiux_scout", "logic_weaver", "pixel_crafter", "guardian"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        context_block = ctx.build_context_block()

        user_prompt = f"""
## Task to Route
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{f"## Prior Context{chr(10)}{context_block}" if context_block else ""}

{self._build_handoff_instructions()}
""".strip()

        try:
            response = await _run_routine_llm(
                self.role, self.system_prompt, user_prompt, ctx, node
            )
            actions = _extract_actions(response)
            swarm_action = _parse_swarm_action(response)

            # Update artifact bus from any publish_artifact actions
            await _execute_file_and_shell_actions(
                [a for a in actions if a.get("action") not in ("transfer_to_uiux_scout",
                 "transfer_to_logic_weaver", "transfer_to_pixel_crafter", "transfer_to_guardian")],
                ctx, node,
            )

            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                updated_ctx = ctx.append_history(
                    self.role, f"Dispatched task to {action_name}: {reason}"
                )
                if action_name == "transfer_to_uiux_scout":
                    return transfer_to_uiux_scout(updated_ctx, reason)
                if action_name == "transfer_to_pixel_crafter":
                    return transfer_to_pixel_crafter(updated_ctx, reason)
                if action_name == "transfer_to_guardian":
                    return transfer_to_guardian(updated_ctx, reason)
                # Default: logic_weaver
                return transfer_to_logic_weaver(updated_ctx, reason)

            # Fallback: infer from task keywords
            updated_ctx = ctx.append_history(self.role, "Dispatched via keyword heuristic")
            text = (ctx.task_title + " " + (ctx.task_description or "")).lower()
            if any(k in text for k in ["ui", "frontend", "react", "component", "design", "css"]):
                return transfer_to_pixel_crafter(updated_ctx, "Frontend keywords detected")
            return transfer_to_logic_weaver(updated_ctx, "Default to backend specialist")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[SwarmDispatcher] Error: %s", exc)
            return transfer_to_logic_weaver(ctx, f"Dispatcher error fallback: {exc}")


# ─── UI/UX Scout Routine ──────────────────────────────────────────────────────
_UIUX_SCOUT_PROMPT = """\
You are the UI/UX Scout — a design-first autonomous agent.

Your mission: research UX best practices, generate a comprehensive Design Spec,
and hand off to the Pixel Crafter with everything they need to build it.

## Skill DNA
- Design Thinking: Visual hierarchy, color palettes, typography, spacing grids
- User Research: Identify persona, flows, interaction patterns
- Accessibility: WCAG AA minimum, ARIA roles, keyboard navigation
- Mobile-first: Every design works at 320px viewport

## Output
1. Write a Design Spec to `design-spec/spec.md`
2. Publish the spec artifact to the message bus
3. Hand off to pixel_crafter

Use write_file action for the spec, publish_artifact for the bus,
then terminate with a transfer action.
""".strip()


class UiUxScoutRoutine(SwarmRoutine):
    """Design-thinking specialist. Produces Design Specs and hands off to Pixel Crafter."""

    role = "uiux_scout"
    system_prompt = _UIUX_SCOUT_PROMPT
    available_transfers = ["pixel_crafter", "logic_weaver"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        context_block = ctx.build_context_block()

        user_prompt = f"""
## Design Research Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{f"## Prior Context{chr(10)}{context_block}" if context_block else ""}

Research UX patterns for this task. Write `design-spec/spec.md` with:
- Color palette (hex codes), typography, spacing system
- Component inventory, UX flow, interaction patterns
- Accessibility requirements

Then publish with:
```action
{{"action": "publish_artifact", "topic": "design_spec", "payload": {{"spec_path": "design-spec/spec.md", "summary": "<one-sentence summary>"}}}}
```

{self._build_handoff_instructions()}
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
                if action_name == "transfer_to_logic_weaver":
                    return transfer_to_logic_weaver(updated_ctx, reason)
            return transfer_to_pixel_crafter(updated_ctx, "Design spec complete — ready for Pixel Crafter")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[UiUxScout] Error: %s", exc)
            return transfer_to_pixel_crafter(ctx, f"UX Scout error fallback: {exc}")


# ─── Logic Weaver Routine ─────────────────────────────────────────────────────
_LOGIC_WEAVER_PROMPT = """\
You are the Logic Weaver — a backend specialist following Clean Architecture and SOLID principles.

## Skill DNA
- API Design: RESTful resources, consistent envelopes, HTTP status codes, versioning
- Clean Architecture: entities/ → use_cases/ → controllers/ → gateways/
- Backend Patterns: Repository pattern, Service layer, Dependency injection
- TDD: Write tests before implementation

## Rules
- NEVER expose raw DB IDs — use UUIDs
- ALL inputs validated at controller boundary (Pydantic)
- Structured logging with correlation-id on every request
- No function longer than 50 lines

After completing, hand off to the Guardian for QA.
""".strip()


class LogicWeaverRoutine(SwarmRoutine):
    """Backend specialist: API, database, Clean Architecture. Hands off to Guardian."""

    role = "logic_weaver"
    system_prompt = _LOGIC_WEAVER_PROMPT
    available_transfers = ["guardian", "devops_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        context_block = ctx.build_context_block()

        user_prompt = f"""
## Backend Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{f"## Shared Context{chr(10)}{context_block}" if context_block else ""}

Build the server-side implementation following Clean Architecture.
Write all files, then hand off to the Guardian for QA.

{self._build_handoff_instructions()}
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
            return transfer_to_guardian(updated_ctx, "Backend work complete — handing to Guardian for QA")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[LogicWeaver] Error: %s", exc)
            return transfer_to_guardian(ctx, f"Logic Weaver error fallback: {exc}")


# ─── Pixel Crafter Routine ────────────────────────────────────────────────────
_PIXEL_CRAFTER_PROMPT = """\
You are the Pixel Crafter — a frontend specialist in React/Next.js and Atomic Design.

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

After completing, hand off to the Guardian for review.
""".strip()


class PixelCrafterRoutine(SwarmRoutine):
    """Frontend specialist: React/Next.js + Atomic Design. Hands off to UiUxScout or Guardian."""

    role = "pixel_crafter"
    system_prompt = _PIXEL_CRAFTER_PROMPT
    available_transfers = ["uiux_scout", "guardian"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        context_block = ctx.build_context_block()

        design_spec = ctx.context_variables.get("design_spec", {})
        api_spec = ctx.context_variables.get("api_spec", {})

        user_prompt = f"""
## Frontend Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{f"## Design Spec Available{chr(10)}{json.dumps(design_spec, indent=2)[:600]}" if design_spec else ""}
{f"## API Spec Available{chr(10)}{json.dumps(api_spec, indent=2)[:400]}" if api_spec else ""}
{f"## Shared Context{chr(10)}{context_block}" if context_block else ""}

Build the frontend using Atomic Design. Write all component and page files.
Then hand off to the Guardian for review.

{self._build_handoff_instructions()}
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
            return transfer_to_guardian(updated_ctx, "Frontend work complete — handing to Guardian for QA")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[PixelCrafter] Error: %s", exc)
            return transfer_to_guardian(ctx, f"Pixel Crafter error fallback: {exc}")


# ─── Guardian Routine ─────────────────────────────────────────────────────────
_GUARDIAN_PROMPT = """\
You are the Guardian — the QA and code review specialist.

## Skill DNA
- TDD: Red-Green-Refactor cycle
- Systematic Debugging: Root cause first, NO fixes without investigation
- Code Review: Critical (security, XSS, injection) → Important → Minor

## Decision Tree
1. List workspace files with read_dir
2. Review key source files
3. Write test file to tests/
4. Run tests with execute_command
5a. If tests PASS and no Critical issues → terminate_and_report
5b. If tests FAIL or Critical issues found → transfer to the previous developer

## Transfer Back Rules
- If bugs found in backend work → transfer_to_logic_weaver
- If bugs found in frontend work → transfer_to_pixel_crafter
- If all checks pass → terminate_and_report (you are the ONLY one who can do this)
""".strip()


class GuardianRoutine(SwarmRoutine):
    """QA + code review specialist. Either terminates the swarm or routes back to developers."""

    role = "guardian"
    system_prompt = _GUARDIAN_PROMPT
    available_transfers = ["logic_weaver", "pixel_crafter", "swarm_dispatcher"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        context_block = ctx.build_context_block()

        # Determine which developer to route back to if bugs found
        last_worker = ctx.last_worker_role or "logic_weaver"
        if "pixel_crafter" in ctx.handoff_chain or "pixel_crafter" in last_worker:
            default_back_role = "pixel_crafter"
        else:
            default_back_role = "logic_weaver"

        user_prompt = f"""
## QA Task
**Title:** {ctx.task_title}
**Description:** {ctx.task_description or "(No additional description)"}

{f"## Shared Context{chr(10)}{context_block}" if context_block else ""}

Hand-off chain so far: {' -> '.join(ctx.handoff_chain)}

1. List all workspace files
2. Review source files for Critical/Important/Minor issues
3. Write and run tests
4. Make your decision:
   - All good → terminate_and_report with a full summary
   - Bugs found → transfer back to {default_back_role} with specific bug details in reason

{self._build_handoff_instructions()}
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

            updated_ctx = ctx.append_history(self.role, "Guardian QA review complete")
            await _finish_node(node, ctx)

            if swarm_action:
                action_name, reason, _ = swarm_action
                if action_name == "terminate_and_report":
                    return terminate_and_report(updated_ctx, reason or f"Task completed: {ctx.task_title}")
                if action_name == "transfer_to_logic_weaver":
                    return transfer_to_logic_weaver(updated_ctx, reason)
                if action_name == "transfer_to_pixel_crafter":
                    return transfer_to_pixel_crafter(updated_ctx, reason)
                if action_name == "transfer_to_swarm_dispatcher":
                    return transfer_to_dispatcher(updated_ctx, reason)

            # Default: auto-terminate if no explicit action (QA considered it done)
            return terminate_and_report(updated_ctx, f"QA complete for: {ctx.task_title}")

        except Exception as exc:
            await _finish_node(node, ctx, "error")
            logger.exception("[Guardian] Error: %s", exc)
            return terminate_and_report(ctx, f"QA completed with errors: {exc}")


# ─── Build Default Swarm ──────────────────────────────────────────────────────
def build_default_swarm() -> list[SwarmRoutine]:
    """Return the default set of routines for the AgentHive Swarm."""
    return [
        SwarmDispatcherRoutine(),
        UiUxScoutRoutine(),
        LogicWeaverRoutine(),
        PixelCrafterRoutine(),
        GuardianRoutine(),
    ]
