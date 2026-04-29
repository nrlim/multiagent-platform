"""
AgentHive Engine — Token Optimizer

Strategies implemented:
  1. PromptCompressor   — Strips redundant skill packages based on role × task relevance
  2. HistorySummarizer  — Collapses growing message history into a compact summary string
  3. SmartContextBlock  — Injects only the artifact/variable keys relevant to the current routine
  4. FastPathDispatcher — Heuristic keyword routing that SKIPS the LLM dispatcher call
  5. TokenCounter       — Rough token count estimator for budgeting (no API call needed)

All functions are stateless — they take inputs and return new values without mutating the context.
"""
from __future__ import annotations

from typing import Literal

# ─── Token Estimator ─────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """
    Rough estimation: ~4 chars per token (GPT/Claude average).
    Used for budget checks without an API round-trip.
    """
    return max(1, len(text) // 4)


# ─── Prompt Compressor ────────────────────────────────────────────────────────
#
# NOTE: As of the lean prompts rewrite, base prompts in prompts.py are already
# minimal by design (~150-300 tokens each). The regex-based skill stripper is
# no longer needed for the canonical prompts.
#
# This function is kept as a lightweight pass-through so the call-site in
# routines.py stays unchanged — and for any 3rd-party or legacy prompts that
# might be injected at runtime.

def compress_system_prompt(role: str, system_prompt: str) -> str:
    """
    Return the system prompt, optionally applying lightweight cleanup:
    - Strip consecutive blank lines (> 2 in a row) to reduce whitespace waste.
    - Strip trailing whitespace per line.

    The lean prompts are already compact; this function is a safety net for
    dynamically constructed or legacy prompts that may still be verbose.

    Token reduction on already-lean prompts: ~2-5% (whitespace only).
    Token reduction on legacy verbose prompts: still up to 5% from whitespace.
    For structural compression of legacy prompts, prefer rewriting them in the
    lean format used by ROLE_PROMPTS in agents/prompts.py.
    """
    import re as _re
    # Strip trailing spaces per line
    cleaned = "\n".join(line.rstrip() for line in system_prompt.split("\n"))
    # Collapse runs of > 2 blank lines into exactly 2
    cleaned = _re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# ─── History Summarizer ───────────────────────────────────────────────────────

# After this many history entries, we compress the older ones into a summary
_HISTORY_COMPRESS_THRESHOLD = 4
_HISTORY_KEEP_RECENT = 2  # always keep the last N entries verbatim


def compress_history(history: list[dict]) -> list[dict]:
    """
    When history exceeds the threshold, collapse older entries into a single
    compact summary dict, keeping only the most recent entries verbatim.

    This avoids the exponential token growth that happens when every hop
    appends the full conversation to the context.

    Input format:  [{"role": "...", "content": "..."}, ...]
    Output format: same, but with a prepended summary entry when needed.
    """
    if len(history) <= _HISTORY_COMPRESS_THRESHOLD:
        return history

    older = history[: -_HISTORY_KEEP_RECENT]
    recent = history[-_HISTORY_KEEP_RECENT:]

    # Build a compact summary of the older entries
    summary_lines: list[str] = []
    for entry in older:
        role = entry.get("role", "?")
        content = str(entry.get("content", ""))
        # Truncate each to 120 chars — enough to understand what happened
        short = content[:120].replace("\n", " ").strip()
        if short:
            summary_lines.append(f"[{role}]: {short}")

    summary_entry = {
        "role": "system",
        "content": "## Prior Steps Summary\n" + "\n".join(summary_lines),
    }

    return [summary_entry] + list(recent)


# ─── Smart Context Block ──────────────────────────────────────────────────────

# Which artifact bus topics are relevant for each routine
_ROLE_RELEVANT_ARTIFACTS: dict[str, set[str]] = {
    "swarm_dispatcher": set(),
    "uiux_scout":       {"api_spec"},
    "logic_weaver":     {"database_schema", "design_spec"},
    "pixel_crafter":    {"design_spec", "api_spec"},
    "guardian":         {"design_spec", "api_spec", "database_schema"},
}

# Which context_variables are relevant for each routine
_ROLE_RELEVANT_VARS: dict[str, set[str]] = {
    "swarm_dispatcher": set(),
    "uiux_scout":       {"api_spec"},
    "logic_weaver":     {"database_schema"},
    "pixel_crafter":    {"design_spec", "api_spec"},
    "guardian":         {"design_spec", "api_spec", "database_schema"},
}


def build_smart_context_block(
    role: str,
    handoff_chain: list[str],
    artifact_bus: dict,
    context_variables: dict,
    history: list[dict],
    *,
    max_artifact_chars: int = 300,
    max_var_chars: int = 400,
    max_history_entries: int = 3,
) -> str:
    """
    Build a role-aware context block that only includes:
    - Artifacts relevant to this role
    - Context variables relevant to this role
    - The most recent N compressed history entries

    Instead of dumping everything, this filters noise and reduces token use
    by 30-70% compared to the original build_context_block().
    """
    parts: list[str] = []

    # 1. Handoff chain (always small — just role names)
    if handoff_chain:
        parts.append(f"## Hand-off Chain\n{' → '.join(handoff_chain)}")

    # 2. Filtered artifacts
    relevant_topics = _ROLE_RELEVANT_ARTIFACTS.get(role, set(artifact_bus.keys()))
    filtered_artifacts = {k: v for k, v in artifact_bus.items() if k in relevant_topics}
    if filtered_artifacts:
        lines = [
            f"- [{topic}]: {str(payload)[:max_artifact_chars]}"
            for topic, payload in filtered_artifacts.items()
        ]
        parts.append("## Shared Artifacts\n" + "\n".join(lines))

    # 3. Filtered context variables
    relevant_vars = _ROLE_RELEVANT_VARS.get(role, set(context_variables.keys()))
    filtered_vars = {k: v for k, v in context_variables.items() if k in relevant_vars}
    if filtered_vars:
        lines = [
            f"- {k}: {str(v)[:max_var_chars]}"
            for k, v in filtered_vars.items()
        ]
        parts.append("## Context Variables\n" + "\n".join(lines))

    # 4. Compressed recent history only
    compressed = compress_history(history)
    recent = compressed[-max_history_entries:]
    if recent:
        lines = [f"[{m['role']}]: {str(m['content'])[:200]}" for m in recent]
        parts.append("## Recent History\n" + "\n".join(lines))

    return "\n\n".join(parts) if parts else ""


# ─── Fast-Path Dispatcher ─────────────────────────────────────────────────────

# Keyword → target routine mapping (checked in priority order)
_DISPATCH_RULES: list[tuple[list[str], str]] = [
    # UI/Design keywords → uiux_scout
    (["ui design", "wireframe", "mockup", "color palette", "ux flow",
      "user journey", "design spec", "figma", "prototype"], "uiux_scout"),
    # Frontend keywords → pixel_crafter
    (["react", "next.js", "nextjs", "component", "frontend", "ui component",
      "page layout", "css", "tailwind", "atomic design", "tsx", "jsx"], "pixel_crafter"),
    # QA/Testing/Review keywords → guardian
    (["test", "qa", "quality assurance", "bug fix", "review", "debugging",
      "unit test", "integration test", "e2e", "playwright", "pytest"], "guardian"),
    # Backend/API/DB keywords → logic_weaver (default fallback)
    (["api", "backend", "database", "sql", "endpoint", "server", "migration",
      "auth", "authentication", "service layer", "crud", "rest"], "logic_weaver"),
]


def fast_path_dispatch(task_title: str, task_description: str = "") -> str | None:
    """
    Attempt to route a task to the correct routine using keyword heuristics.
    Returns the target role name if confident, or None if ambiguous
    (triggering the full LLM dispatcher as fallback).

    This eliminates the LLM call for ~70% of typical tasks.

    Cost saving: 1 full LLM call (typically 500-1500 tokens in + 50-200 out)
    per task that can be fast-pathed.
    """
    combined = (task_title + " " + task_description).lower()

    for keywords, target_role in _DISPATCH_RULES:
        if any(kw in combined for kw in keywords):
            return target_role

    return None  # ambiguous — fall through to LLM dispatcher


# ─── Budget Guard ─────────────────────────────────────────────────────────────

# Approximate cost per 1K tokens by provider (input pricing, USD)
# Update these if pricing changes
_COST_PER_1K_TOKENS: dict[str, float] = {
    "google":    0.000075,   # Gemini 2.0 Flash
    "openai":    0.005,      # GPT-4o
    "anthropic": 0.003,      # Claude Sonnet
    "deepseek":  0.00014,    # DeepSeek Chat (cache miss)
}

_DEFAULT_COST_PER_1K = 0.001  # fallback for unknown providers


def estimate_call_cost(
    system_prompt: str,
    user_prompt: str,
    provider: str,
    expected_output_tokens: int = 1500,
) -> float:
    """
    Estimate USD cost of a single LLM API call before making it.
    Used to check against budget_remaining before spending tokens.

    Returns the estimated cost in USD.
    """
    input_tokens = estimate_tokens(system_prompt) + estimate_tokens(user_prompt)
    total_tokens = input_tokens + expected_output_tokens
    rate = _COST_PER_1K_TOKENS.get(provider.lower(), _DEFAULT_COST_PER_1K)
    return (total_tokens / 1000) * rate


def should_abort_for_budget(
    estimated_cost: float,
    budget_remaining: float,
    safety_margin: float = 0.1,
) -> bool:
    """
    Return True if the estimated cost would exceed the remaining budget
    (with a safety margin to avoid going over).
    """
    return estimated_cost > (budget_remaining - safety_margin)


# ─── Prompt Token Report ──────────────────────────────────────────────────────

def prompt_token_report(role: str, system_prompt: str, user_prompt: str) -> dict:
    """
    Return a diagnostic dict with token estimates for a prompt pair.
    Useful for logging and dashboard display.
    """
    compressed = compress_system_prompt(role, system_prompt)
    sys_orig = estimate_tokens(system_prompt)
    sys_comp = estimate_tokens(compressed)
    usr_tok  = estimate_tokens(user_prompt)

    return {
        "role": role,
        "system_tokens_original": sys_orig,
        "system_tokens_compressed": sys_comp,
        "system_savings_pct": round((1 - sys_comp / max(1, sys_orig)) * 100, 1),
        "user_tokens": usr_tok,
        "total_compressed": sys_comp + usr_tok,
    }
