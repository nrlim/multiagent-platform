"""
AgentHive Engine - Anthropic Claude Agent
"""
from langchain_core.language_models import BaseChatModel
from langchain_anthropic import ChatAnthropic

from app.agents.base import BaseAgent, LogEmitter
from app import config


class AnthropicAgent(BaseAgent):
    """Agent implementation backed by Anthropic Claude via LangChain."""

    def __init__(self, model: str | None = None, log_emitter: LogEmitter | None = None):
        super().__init__(model or config.ANTHROPIC_MODEL, log_emitter)

    def _build_llm(self) -> BaseChatModel:
        if not config.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY is not set in the environment.")
        self.log("info", f"🧠 Initializing Claude [{self.model_name}]")
        return ChatAnthropic(
            model=self.model_name,
            anthropic_api_key=config.ANTHROPIC_API_KEY,
            temperature=0.7,
            streaming=True,
        )
