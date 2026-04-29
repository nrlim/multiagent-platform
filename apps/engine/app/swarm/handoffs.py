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


def transfer_to_logic_weaver(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the Logic Weaver (Backend) for API and business logic work."""
    return Transfer(
        target_routine="logic_weaver",
        context=ctx,
        reason=reason or "Transferring to Logic Weaver for backend implementation.",
    )


def transfer_to_pixel_crafter(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the Pixel Crafter (Frontend) for React/Next.js UI work."""
    return Transfer(
        target_routine="pixel_crafter",
        context=ctx,
        reason=reason or "Transferring to Pixel Crafter for frontend implementation.",
    )


def transfer_to_guardian(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Hand off to the Guardian (QA) for testing and code review."""
    return Transfer(
        target_routine="guardian",
        context=ctx,
        reason=reason or "Transferring to Guardian for quality assurance.",
    )


def transfer_to_dispatcher(ctx: SwarmContext, reason: str = "") -> Transfer:
    """Return control to the Dispatcher Routine (task completed successfully)."""
    return Transfer(
        target_routine="swarm_dispatcher",
        context=ctx,
        reason=reason or "Returning control to Dispatcher — task cycle complete.",
    )


def terminate_and_report(ctx: SwarmContext, final_output: str) -> str:
    """
    Signal the Swarm to terminate and return a final answer.

    This is the ONLY exit point for a successful task completion.
    Only the Guardian routine should call this after all quality checks pass.

    Parameters
    ----------
    ctx          : Current SwarmContext (used for logging; not mutated).
    final_output : Human-readable summary of what was accomplished.

    Returns
    -------
    str : The final_output (returned directly to Swarm.run_swarm).
    """
    return final_output
