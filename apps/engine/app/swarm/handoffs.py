"""
AgentHive Swarm Engine - Hand-off Functions

Provides type-safe transfer factory functions used inside SwarmRoutine.run()
implementations to produce Transfer objects.

Each function follows the naming convention: transfer_to_<role>(ctx, reason) -> Transfer
The `terminate_and_report` function signals the swarm to stop and return a final answer.
"""
from __future__ import annotations

from app.swarm.core import SwarmContext, Transfer


def transfer_to_uiux_scout(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the UI/UX Scout for design research and specification."""
    return Transfer(
        target_routine="uiux_scout",
        context=ctx,
        reason=reason or "Transferring to UI/UX Scout for design research.",
    )


def transfer_to_backend_dev(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the Backend Developer for API and business logic work."""
    return Transfer(
        target_routine="backend_dev",
        context=ctx,
        reason=reason or "Transferring to Backend Developer for backend implementation.",
    )


# Alias for backward compat (do not use in new code)
transfer_to_logic_weaver = transfer_to_backend_dev


def transfer_to_frontend_dev(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the Frontend Developer for React/Next.js UI work."""
    return Transfer(
        target_routine="frontend_dev",
        context=ctx,
        reason=reason or "Transferring to Frontend Developer for frontend implementation.",
    )


# Alias for backward compat (do not use in new code)
transfer_to_pixel_crafter = transfer_to_frontend_dev


def transfer_to_qa_engineer(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the QA Engineer for testing and code review."""
    return Transfer(
        target_routine="qa_engineer",
        context=ctx,
        reason=reason or "Transferring to QA Engineer for quality assurance.",
    )


# Alias for backward compat (do not use in new code)
transfer_to_guardian = transfer_to_qa_engineer


def transfer_to_dispatcher(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Return control to the Dispatcher Routine (task completed successfully)."""
    return Transfer(
        target_routine="swarm_dispatcher",
        context=ctx,
        reason=reason or "Returning control to Dispatcher — task cycle complete.",
    )


def transfer_to_uiux_researcher(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the UI/UX Researcher for deep design research."""
    return Transfer(
        target_routine="uiux_researcher",
        context=ctx,
        reason=reason or "Transferring to UI/UX Researcher for design specification.",
    )


def transfer_to_code_reviewer(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the Code Reviewer for quality gating."""
    return Transfer(
        target_routine="code_reviewer",
        context=ctx,
        reason=reason or "Transferring to Code Reviewer for quality assurance.",
    )


def terminate_and_report(ctx: SwarmContext, final_output: str) -> str:
    """
    Signal the Swarm to terminate and return a final answer.

    This is the ONLY exit point for a successful task completion.
    Only the QA Engineer routine should call this after all quality checks pass.

    Parameters
    ----------
    ctx          : Current SwarmContext (used for logging; not mutated).
    final_output : Human-readable summary of what was accomplished.

    Returns
    -------
    str : The final_output (returned directly to Swarm.run_swarm).
    """
    return final_output
