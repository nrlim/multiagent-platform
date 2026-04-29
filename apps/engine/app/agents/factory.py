"""
AgentHive Engine - Provider Factory
Creates the correct agent based on the provider string from config or request.
"""
from app.agents.base import BaseAgent, LogEmitter
from app import config


def create_agent(
    provider: str | None = None,
    model: str | None = None,
    log_emitter: LogEmitter | None = None,
) -> BaseAgent:
    """
    Factory function to instantiate the correct agent for a given provider.

    Args:
        provider: One of 'google', 'openai', 'anthropic', 'deepseek'. Defaults to env PROVIDER.
        model: Optional model override. Defaults to provider's default model.
        log_emitter: Callback for log events. Signature: (level: str, message: str) -> None

    Returns:
        A concrete BaseAgent instance ready to execute prompts.

    Raises:
        ValueError: If the provider is not supported.
    """
    resolved_provider = (provider or config.DEFAULT_PROVIDER).lower().strip()

    if resolved_provider == "google":
        from app.agents.gemini_agent import GeminiAgent
        return GeminiAgent(model=model, log_emitter=log_emitter)

    elif resolved_provider == "openai":
        from app.agents.openai_agent import OpenAIAgent
        return OpenAIAgent(model=model, log_emitter=log_emitter)

    elif resolved_provider == "anthropic":
        from app.agents.anthropic_agent import AnthropicAgent
        return AnthropicAgent(model=model, log_emitter=log_emitter)

    elif resolved_provider == "deepseek":
        from app.agents.deepseek_agent import DeepSeekAgent
        return DeepSeekAgent(model=model, log_emitter=log_emitter)

    else:
        supported = ["google", "openai", "anthropic", "deepseek"]
        raise ValueError(
            f"Unsupported provider '{resolved_provider}'. "
            f"Must be one of: {supported}"
        )


def get_available_providers() -> list[dict]:
    """Return metadata about all available providers."""
    return [
        {
            "id": "google",
            "label": "Google Gemini",
            "configured": bool(config.GOOGLE_API_KEY),
            "defaultModel": config.GOOGLE_MODEL,
        },
        {
            "id": "openai",
            "label": "OpenAI GPT",
            "configured": bool(config.OPENAI_API_KEY),
            "defaultModel": config.OPENAI_MODEL,
        },
        {
            "id": "anthropic",
            "label": "Anthropic Claude",
            "configured": bool(config.ANTHROPIC_API_KEY),
            "defaultModel": config.ANTHROPIC_MODEL,
        },
        {
            "id": "deepseek",
            "label": "DeepSeek",
            "configured": bool(config.DEEPSEEK_API_KEY),
            "defaultModel": config.DEEPSEEK_MODEL,
        },
    ]
