"""
Inject _emit_chat() calls into each routine's run() method at key points.
"""
import pathlib
import re

path = pathlib.Path("routines.py")
text = path.read_text(encoding="utf-8")

# ─── 1. SwarmDispatcher: emit CHAT on spawn (fast-path) ──────────────────────
# After fast_role is determined, emit CHAT before returning the transfer
OLD1 = '''        if fast_role:
            updated_ctx = ctx.append_history(
                self.role, f"Fast-path routed to {fast_role} (no LLM call)"
            )
            logger.info("[SwarmDispatcher] Fast-path → %s (saved LLM call)", fast_role)
            if fast_role == "uiux_scout":
                return transfer_to_uiux_scout(updated_ctx, "Fast-path: UI/design keywords")
            if fast_role == "frontend_dev":
                return transfer_to_frontend_dev(updated_ctx, "Fast-path: frontend keywords")
            if fast_role == "qa_engineer":
                return transfer_to_qa_engineer(updated_ctx, "Fast-path: QA/test keywords")
            return transfer_to_backend_dev(updated_ctx, "Fast-path: backend keywords")'''

NEW1 = '''        if fast_role:
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
            return transfer_to_backend_dev(updated_ctx, "Fast-path: backend keywords")'''

# ─── 2. SwarmDispatcher: emit CHAT on LLM-based routing ──────────────────────
OLD2 = '''            if swarm_action:
                action_name, reason, _ = swarm_action
                updated_ctx = ctx.append_history(
                    self.role, f"LLM-routed to {action_name}: {reason}"
                )
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
                return transfer_to_backend_dev(updated_ctx, reason)'''

NEW2 = '''            if swarm_action:
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
                return transfer_to_backend_dev(updated_ctx, reason)'''

# ─── 3. Each specialist: emit CHAT on node creation ──────────────────────────
# UiUxScoutRoutine
OLD3 = '''class UiUxScoutRoutine(SwarmRoutine):
    """Design-thinking specialist. Produces Design Specs and hands off to Pixel Crafter."""

    role = "uiux_scout"
    system_prompt = _UIUX_SCOUT_PROMPT
    available_transfers = ["frontend_dev", "backend_dev"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)'''

NEW3 = '''class UiUxScoutRoutine(SwarmRoutine):
    """Design-thinking specialist. Produces Design Specs and hands off to Frontend Developer."""

    role = "uiux_scout"
    system_prompt = _UIUX_SCOUT_PROMPT
    available_transfers = ["frontend_dev", "backend_dev"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")'''

# BackendDevRoutine
OLD4 = '''class BackendDevRoutine(SwarmRoutine):
    """Backend specialist: API, database, Clean Architecture. Hands off to QA Engineer."""

    role = "backend_dev"
    system_prompt = _LOGIC_WEAVER_PROMPT
    available_transfers = ["qa_engineer", "devops_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)'''

NEW4 = '''class BackendDevRoutine(SwarmRoutine):
    """Backend specialist: API, database, Clean Architecture. Hands off to QA Engineer."""

    role = "backend_dev"
    system_prompt = _LOGIC_WEAVER_PROMPT
    available_transfers = ["qa_engineer", "devops_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")'''

# FrontendDevRoutine
OLD5 = '''class FrontendDevRoutine(SwarmRoutine):
    """Frontend specialist: React/Next.js + Atomic Design. Hands off to UiUxScout or QA Engineer."""

    role = "frontend_dev"
    system_prompt = _PIXEL_CRAFTER_PROMPT
    available_transfers = ["uiux_scout", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)'''

NEW5 = '''class FrontendDevRoutine(SwarmRoutine):
    """Frontend specialist: React/Next.js + Atomic Design. Hands off to UiUxScout or QA Engineer."""

    role = "frontend_dev"
    system_prompt = _PIXEL_CRAFTER_PROMPT
    available_transfers = ["uiux_scout", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")'''

# QaEngineerRoutine
OLD6 = '''class QaEngineerRoutine(SwarmRoutine):
    """QA + code review specialist. Either terminates the swarm or routes back to developers."""

    role = "qa_engineer"
    system_prompt = _GUARDIAN_PROMPT
    available_transfers = ["backend_dev", "frontend_dev"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)'''

NEW6 = '''class QaEngineerRoutine(SwarmRoutine):
    """QA + code review specialist. Either terminates the swarm or routes back to developers."""

    role = "qa_engineer"
    system_prompt = _GUARDIAN_PROMPT
    available_transfers = ["backend_dev", "frontend_dev"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")'''

# UiUxResearcherRoutine
OLD7 = '''class UiUxResearcherRoutine(SwarmRoutine):
    """Deep design research. Produces a Design Spec then hands off to Pixel Crafter."""

    role = "uiux_researcher"
    system_prompt = _UIUX_RESEARCHER_PROMPT
    available_transfers = ["frontend_dev", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        from app.swarm.handoffs import transfer_to_frontend_dev as _tpc
        node = _make_agent_node(self.role, ctx)'''

NEW7 = '''class UiUxResearcherRoutine(SwarmRoutine):
    """Deep design research. Produces a Design Spec then hands off to Frontend Developer."""

    role = "uiux_researcher"
    system_prompt = _UIUX_RESEARCHER_PROMPT
    available_transfers = ["frontend_dev", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        from app.swarm.handoffs import transfer_to_frontend_dev as _tpc
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")'''

# CodeReviewerRoutine
OLD8 = '''class CodeReviewerRoutine(SwarmRoutine):
    """Code review specialist. Approves or routes back to the developer."""

    role = "code_reviewer"
    system_prompt = _CODE_REVIEWER_PROMPT
    available_transfers = ["backend_dev", "frontend_dev", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)'''

NEW8 = '''class CodeReviewerRoutine(SwarmRoutine):
    """Code review specialist. Approves or routes back to the developer."""

    role = "code_reviewer"
    system_prompt = _CODE_REVIEWER_PROMPT
    available_transfers = ["backend_dev", "frontend_dev", "qa_engineer"]

    async def run(self, ctx: SwarmContext) -> Transfer | str:
        node = _make_agent_node(self.role, ctx)
        _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "spawn")'''

# ─── 4. QA Engineer: emit CHAT on terminate ──────────────────────────────────
OLD9 = '''                if action_name == "terminate_and_report":
                    return terminate_and_report(updated_ctx, reason or f"Task completed: {ctx.task_title}")'''

NEW9 = '''                if action_name == "terminate_and_report":
                    _emit_chat(ctx.hive_id, node.id, self.role, ctx.task_title, "complete")
                    return terminate_and_report(updated_ctx, reason or f"Task completed: {ctx.task_title}")'''

replacements = [
    (OLD1, NEW1),
    (OLD2, NEW2),
    (OLD3, NEW3),
    (OLD4, NEW4),
    (OLD5, NEW5),
    (OLD6, NEW6),
    (OLD7, NEW7),
    (OLD8, NEW8),
    (OLD9, NEW9),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new)
        print(f"Applied: {old[:50]!r}...")
    else:
        print(f"NOT FOUND: {old[:60]!r}...")

path.write_text(text, encoding="utf-8")
print("Done.")
