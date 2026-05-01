"""
AgentHive Swarm Engine - Public API

Implements the Agent Swarm architecture with true parallel execution.
Primitives: Routines (stateless agents), Transfers (sequential), ParallelTransfer (parallel fan-out).
"""
from app.swarm.core import (
    SwarmContext,
    SwarmRoutine,
    Transfer,
    ParallelBranch,
    ParallelTransfer,
    BranchResult,
    Swarm,
    run_swarm,
)
from app.swarm.routines import build_default_swarm, PlannerRoutine, ResultMergerRoutine
from app.swarm.handoffs import (
    transfer_to_uiux_scout,
    transfer_to_backend_dev,
    transfer_to_frontend_dev,
    transfer_to_qa_engineer,
    transfer_to_dispatcher,
    terminate_and_report,
)

__all__ = [
    "SwarmContext",
    "SwarmRoutine",
    "Transfer",
    "ParallelBranch",
    "ParallelTransfer",
    "BranchResult",
    "Swarm",
    "run_swarm",
    "build_default_swarm",
    "PlannerRoutine",
    "ResultMergerRoutine",
    "transfer_to_uiux_scout",
    "transfer_to_backend_dev",
    "transfer_to_frontend_dev",
    "transfer_to_qa_engineer",
    "transfer_to_dispatcher",
    "terminate_and_report",
]
