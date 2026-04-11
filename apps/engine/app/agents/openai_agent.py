"""
AgentHive Engine - OpenAI GPT Agent
"""
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.agents.base import BaseAgent, LogEmitter
from app import config


class OpenAIAgent(BaseAgent):
    """Agent implementation backed by OpenAI GPT via LangChain."""

    def __init__(self, model: str | None = None, log_emitter: LogEmitter | None = None):
        super().__init__(model or config.OPENAI_MODEL, log_emitter)

    def _build_llm(self) -> BaseChatModel:
        if not config.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is not set in the environment.")
        self.log("info", f"🤖 Initializing OpenAI GPT [{self.model_name}]")
        return ChatOpenAI(
            model=self.model_name,
            openai_api_key=config.OPENAI_API_KEY,
            temperature=0.7,
            streaming=True,
        )
