# AgentHive Engine

Model-agnostic Python execution engine for the AgentHive platform.

## Setup

```bash
# Install Poetry (if not already)
pip install poetry

# Install dependencies
cd apps/engine
poetry install

# Copy env file
cp .env.example .env
# Edit .env and add your API keys

# Run the engine
poetry run python main.py
# or
poetry run uvicorn app.main:app --reload --port 8000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Engine health check |
| GET | `/providers` | List configured LLM providers |
| POST | `/execute` | Start an agent session |
| GET | `/sessions/{id}/stream` | SSE log stream |
| GET | `/sessions` | List all sessions |
| GET | `/workspace` | Full workspace file tree |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER` | `google` | Default LLM provider |
| `GOOGLE_API_KEY` | - | Google Gemini API key |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `WORKSPACE_DIR` | `../../workspace` | Agent output directory |
| `ENGINE_PORT` | `8000` | Server port |
