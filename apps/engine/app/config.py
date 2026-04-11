"""
AgentHive Engine - Configuration & Settings (Phase 3)
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from engine directory
_engine_dir = Path(__file__).parent.parent
load_dotenv(_engine_dir / ".env")

# ─── Workspace ────────────────────────────────────────────────────────────────
_workspace_rel = os.getenv("WORKSPACE_DIR", "../../workspace")
WORKSPACE_DIR = (Path(__file__).parent.parent / _workspace_rel).resolve()
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

# ─── Server ───────────────────────────────────────────────────────────────────
ENGINE_HOST: str = os.getenv("ENGINE_HOST", "0.0.0.0")
ENGINE_PORT: int = int(os.getenv("ENGINE_PORT", "8000"))
DASHBOARD_ORIGIN: str = os.getenv("DASHBOARD_ORIGIN", "http://localhost:3000")

# ─── LLM Providers ───────────────────────────────────────────────────────────
DEFAULT_PROVIDER: str = os.getenv("PROVIDER", "google")

GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

GOOGLE_MODEL: str = os.getenv("GOOGLE_MODEL", "gemini-2.0-flash")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")

DEFAULT_MODELS: dict[str, str] = {
    "google": GOOGLE_MODEL,
    "openai": OPENAI_MODEL,
    "anthropic": ANTHROPIC_MODEL,
}

# ─── Phase 3: Redis & Database ────────────────────────────────────────────────
REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL: str = os.getenv("DATABASE_URL", "")

# ─── Phase 5: Budget Guardrail ────────────────────────────────────────────────────────
BUDGET_LIMIT: float = float(os.getenv("BUDGET_LIMIT", "2.0"))  # USD kill threshold
