# AgentHive — Phase 1 Complete 🐝

## What Was Built

A fully functional monorepo where AI agents can write code, run commands, and stream logs to a dashboard in real time.

---

## Monorepo Structure

```
multiagent-platform/
├── package.json              ← PNPM root manifest
├── pnpm-workspace.yaml       ← Workspace definition
├── README.md
│
├── apps/
│   ├── engine/               ← Python FastAPI backend (Poetry)
│   │   ├── pyproject.toml
│   │   ├── main.py           ← uvicorn entrypoint
│   │   ├── .env.example
│   │   └── app/
│   │       ├── main.py       ← FastAPI routes (REST + SSE)
│   │       ├── config.py     ← Env-driven config
│   │       ├── session.py    ← In-memory session store + asyncio queues
│   │       ├── executor.py   ← LLM→action→tools orchestration loop
│   │       ├── agents/
│   │       │   ├── base.py           ← Abstract BaseAgent
│   │       │   ├── gemini_agent.py
│   │       │   ├── openai_agent.py
│   │       │   ├── anthropic_agent.py
│   │       │   └── factory.py        ← Provider factory (lazy imports)
│   │       └── tools/
│   │           ├── filesystem.py     ← write_file, read_dir, delete_file, mkdir
│   │           └── terminal.py       ← execute_command (sync + async)
│   │
│   └── dashboard/            ← Next.js 16 App Router
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx              ← Main dashboard (SSE + state)
│       │   └── api/engine/[...path]/ ← Universal proxy → Python engine
│       ├── components/
│       │   ├── agent-control.tsx     ← Provider/model/prompt form
│       │   ├── terminal-output.tsx   ← Live log viewer
│       │   └── file-tree.tsx         ← Workspace explorer
│       ├── lib/
│       │   └── engine-client.ts      ← Typed API client + SSE helper
│       └── .env.local
│
├── packages/
│   └── shared/src/index.ts   ← Shared TS types (LLMProvider, FileNode, etc.)
│
└── workspace/                ← Agent output (session-{id}/ dirs created here)
```

---

## Setup Steps

### Step 1: Install Python Engine

```powershell
cd apps/engine

# Install Poetry globally (skip if already installed)
pip install poetry

# Install all dependencies
poetry install

# Copy and fill env
copy .env.example .env
notepad .env   # Add your API keys
```

### Step 2: Start the Engine

```powershell
# From apps/engine
poetry run python main.py
# Engine runs at http://localhost:8000
```

Verify it works:
```
GET http://localhost:8000/health
```

### Step 3: Start the Dashboard

```powershell
# From monorepo root
pnpm --filter dashboard dev
# Dashboard at http://localhost:3000
```

---

## API Keys Required

Edit `apps/engine/.env`:

```env
PROVIDER=google

GOOGLE_API_KEY=AIza...      # https://aistudio.google.com/
OPENAI_API_KEY=sk-...       # https://platform.openai.com/
ANTHROPIC_API_KEY=sk-ant-...  # https://console.anthropic.com/
```

> At minimum, set **one** key. The dashboard shows only what's configured.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Engine status |
| `GET` | `/providers` | Configured providers |
| `POST` | `/execute` | Start agent session |
| `GET` | `/sessions/{id}/stream` | **SSE log stream** |
| `GET` | `/sessions` | Session history |
| `GET` | `/workspace/{session_id}` | File tree for session |

### POST `/execute` body
```json
{
  "prompt": "Create a Hello World React app",
  "provider": "google",
  "model": "gemini-2.0-flash"
}
```

---

## How the SSE Streaming Works

```
Dashboard                   Next.js API Proxy             Python Engine
    │                             │                             │
    │──POST /api/engine/execute──►│──POST /execute─────────────►│
    │◄──{ session_id }────────────│◄──{ session_id }────────────│
    │                             │                             │
    │──GET /api/engine/sessions   │                             │
    │      /{id}/stream (SSE)────►│──GET /{id}/stream (SSE)────►│
    │                             │         (background task)   │
    │◄──event: log { message }────│◄──event: log { message }────│
    │◄──event: log { message }────│◄──event: log { message }────│
    │◄──event: done { status }────│◄──event: done { status }────│
```

---

## Success Criteria Test

1. Open `http://localhost:3000`
2. Select **Gemini** provider
3. Enter prompt: `Create a basic Hello World React app in the workspace`
4. Click **Execute with Gemini**
5. Watch **Terminal** tab stream live logs
6. After completion → switch to **File Tree** tab
7. See `session-{id}/` directory with React files

