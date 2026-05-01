"""
AgentHive Engine - Kimi Agent (Moonshot AI)
Kimi exposes an OpenAI-compatible API, so we reuse ChatOpenAI
with a custom base_url pointing at api.moonshot.cn.
"""

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app import config
from app.agents.base import BaseAgent, LogEmitter

KIMI_BASE_URL = "https://api.moonshot.ai/v1"


class KimiAgent(BaseAgent):
    """Agent backed by Moonshot AI (Kimi) via their OpenAI-compatible API."""

    def __init__(self, model: str | None = None, log_emitter: LogEmitter | None = None):
        super().__init__(model or config.KIMI_MODEL, log_emitter)

    def _build_llm(self) -> BaseChatModel:
        if not config.KIMI_API_KEY:
            raise ValueError("KIMI_API_KEY is not set in the environment.")
        self.log("info", f"🌙 Initializing Kimi [{self.model_name}]")
        return ChatOpenAI(
            model=self.model_name,
            api_key=config.KIMI_API_KEY,
            base_url=KIMI_BASE_URL,
            temperature=1.0,
            streaming=True,
        )
