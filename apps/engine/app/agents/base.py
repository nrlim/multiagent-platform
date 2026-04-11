"""
AgentHive Engine - Abstract Base Agent & Provider Factory
"""
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import AsyncIterator, Callable

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage


# ─── Log Emitter Type ─────────────────────────────────────────────────────────
LogEmitter = Callable[[str, str], None]  # (level, message)


# ─── Abstract Base Agent ──────────────────────────────────────────────────────
class BaseAgent(ABC):
    """
    Abstract base class that all provider-specific agents must implement.
    Standardizes how different LLMs are invoked and how tools are called.
    """

    SYSTEM_PROMPT = """You are AgentHive, an expert software engineer AI agent.
Your goal is to complete programming tasks by writing files and executing commands.

When given a task:
1. Break it down into concrete steps.
2. Use the available tools to create files, read directories, and run commands.
3. Narrate each step clearly so the user can follow along.
4. Always produce working, production-quality code.
5. After completing, summarize what was done.

Available tools will be described to you. Always prefer small, focused actions.
"""

    def __init__(self, model: str, log_emitter: LogEmitter | None = None):
        self.model_name = model
        self._log = log_emitter or (lambda level, msg: print(f"[{level.upper()}] {msg}"))
        self._llm: BaseChatModel | None = None

    @abstractmethod
    def _build_llm(self) -> BaseChatModel:
        """Instantiate and return the provider-specific LangChain LLM."""
        ...

    @property
    def llm(self) -> BaseChatModel:
        if self._llm is None:
            self._llm = self._build_llm()
        return self._llm

    def log(self, level: str, message: str) -> None:
        self._log(level, message)

    async def think(self, prompt: str) -> str:
        """
        Send a prompt to the LLM and return its full text response.
        Runs the synchronous LangChain call in a thread to stay async-friendly.
        """
        self.log("info", f"🤖 [{self.model_name}] Processing prompt...")
        messages = [
            SystemMessage(content=self.SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ]

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, self.llm.invoke, messages)
        return response.content  # type: ignore[return-value]

    async def stream_think(self, prompt: str) -> AsyncIterator[str]:
        """Stream tokens from the LLM response."""
        messages = [
            SystemMessage(content=self.SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ]
        async for chunk in self.llm.astream(messages):
            yield chunk.content  # type: ignore[attr-defined]
