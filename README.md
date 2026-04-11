# 🐝 AgentHive — Recursive Multi-Agent Platform

A monorepo platform where LLM agents can automatically write code, run commands, and spawn other agents — with real-time streaming to a modern Next.js dashboard.

## Architecture

```
multiagent-platform/
├── apps/
│   ├── engine/          # Python FastAPI + LangChain (Poetry)
│   └── dashboard/       # Next.js 15 App Router + ShadcnUI
├── packages/
│   └── shared/          # Shared TypeScript types & constants
└── workspace/           # Agent-generated code output
```

## Quick Start

### 1. Python Engine

```bash
cd apps/engine

# Install Poetry (once)
pip install poetry

# Install dependencies
poetry install

# Configure API keys
cp .env.example .env
# Edit .env with your keys

# Start the engine (port 8000)
poetry run python main.py
```

### 2. Next.js Dashboard

```bash
cd apps/dashboard

# Install (from root)
pnpm install

# Start dashboard (port 3000)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Features

- 🤖 **Model-Agnostic**: Switch between Gemini, GPT-4o, Claude via UI
- ⚡ **Real-time Streaming**: SSE logs streamed live to the terminal
- 📁 **File Tree**: Visual workspace explorer after each session
- 🛡️ **Sandboxed Execution**: All agent actions confined to `/workspace`
- 🔄 **Session History**: Full audit trail of all agent runs

## Environment Variables

### Engine (`apps/engine/.env`)
| Key | Description |
|-----|-------------|
| `PROVIDER` | Default provider (`google` / `openai` / `anthropic`) |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |

### Dashboard (`apps/dashboard/.env.local`)
| Key | Default | Description |
|-----|---------|-------------|
| `ENGINE_URL` | `http://localhost:8000` | Engine base URL |
