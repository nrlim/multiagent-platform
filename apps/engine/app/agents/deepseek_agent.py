"""
AgentHive Engine - DeepSeek Agent
DeepSeek exposes an OpenAI-compatible API, so we reuse ChatOpenAI
with a custom base_url pointing at api.deepseek.com.
"""
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.agents.base import BaseAgent, LogEmitter
from app import config

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"


class DeepSeekAgent(BaseAgent):
    """Agent backed by DeepSeek via their OpenAI-compatible API."""

    def __init__(self, model: str | None = None, log_emitter: LogEmitter | None = None):
        super().__init__(model or config.DEEPSEEK_MODEL, log_emitter)

    def _build_llm(self) -> BaseChatModel:
        if not config.DEEPSEEK_API_KEY:
            raise ValueError("DEEPSEEK_API_KEY is not set in the environment.")
        self.log("info", f"🐋 Initializing DeepSeek [{self.model_name}]")
        return ChatOpenAI(
            model=self.model_name,
            api_key=config.DEEPSEEK_API_KEY,
            base_url=DEEPSEEK_BASE_URL,
            temperature=0.7,
            streaming=True,
        )
