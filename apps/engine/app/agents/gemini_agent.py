"""
AgentHive Engine - Google Gemini Agent
"""
from langchain_core.language_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI

from app.agents.base import BaseAgent, LogEmitter
from app import config


class GeminiAgent(BaseAgent):
    """Agent implementation backed by Google Gemini via LangChain."""

    def __init__(self, model: str | None = None, log_emitter: LogEmitter | None = None):
        super().__init__(model or config.GOOGLE_MODEL, log_emitter)

    def _build_llm(self) -> BaseChatModel:
        if not config.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY is not set in the environment.")
        self.log("info", f"🔮 Initializing Gemini [{self.model_name}]")
        return ChatGoogleGenerativeAI(
            model=self.model_name,
            google_api_key=config.GOOGLE_API_KEY,
            temperature=0.7,
            streaming=True,
        )
