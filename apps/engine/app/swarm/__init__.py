"""
AgentHive Swarm Engine - Public API

Implements the Agent Swarm architecture inspired by OpenAI Swarm.
Two primitives: Routines (stateless agents) and Transfers (hand-offs).
"""
from app.swarm.core import (
    SwarmContext,
    SwarmRoutine,
    Transfer,
    Swarm,
    run_swarm,
)
from app.swarm.routines import build_default_swarm
from app.swarm.handoffs import (
    transfer_to_uiux_scout,
    transfer_to_logic_weaver,
    transfer_to_pixel_crafter,
    transfer_to_guardian,
    transfer_to_dispatcher,
    terminate_and_report,
)

__all__ = [
    "SwarmContext",
    "SwarmRoutine",
    "Transfer",
    "Swarm",
    "run_swarm",
    "build_default_swarm",
    "transfer_to_uiux_scout",
    "transfer_to_logic_weaver",
    "transfer_to_pixel_crafter",
    "transfer_to_guardian",
    "transfer_to_dispatcher",
    "terminate_and_report",
]
