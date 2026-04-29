# AgentHive - Final Technology Stack

This document outlines the core technology stack used in the AgentHive Multi-Agent Platform.

## 🏗️ Core Architecture
- **Monorepo Management**: [PNPM Workspaces](https://pnpm.io/workspaces)
- **Deployment**: Docker & Docker Compose (Production-ready configurations)

---

## 🎨 Frontend (Dashboard)
Located in `apps/dashboard`

- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: 
  - [Tailwind CSS v4](https://tailwindcss.com/)
  - [Framer Motion](https://www.framer.com/motion/) (Micro-interactions & Animations)
- **UI Components**: 
  - [Radix UI](https://www.radix-ui.com/) (Primitives)
  - [Lucide React](https://lucide.dev/) (Icons)
  - Custom Stone/Slate Light Theme Design System
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Specialized UI Libraries**:
  - [XYFlow (React Flow)](https://reactflow.dev/) - Orchestration Graph Visualization
  - [XTerm.js](https://xtermjs.org/) - Real-time Agent Terminal
  - [React Syntax Highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter) - Professional Code IDE Experience

---

## ⚙️ Backend (Engine)
Located in `apps/engine`

- **Runtime**: [Python 3.11+](https://www.python.org/)
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (High-performance Async API)
- **AI Orchestration**: [LangChain](https://www.langchain.com/) (Chain-of-thought, Swarm routines)
- **Supported LLM Providers**: 
  - Google Gemini (Primary)
  - OpenAI GPT
  - Anthropic Claude
  - DeepSeek
- **Real-time Communication**: 
  - Server-Sent Events (SSE) for agent log streaming
  - WebSockets for terminal interaction

---

## 💾 Persistence & Infrastructure
- **Primary Database**: [PostgreSQL](https://www.postgresql.org/)
- **ORM**: [Prisma](https://www.prisma.io/) (via `prisma-client-py`)
- **Event Bus / Caching**: [Redis](https://redis.io/)
- **Environment Management**: [Poetry](https://python-poetry.org/) (Backend dependencies)

---

## 🧹 Code Quality & Standards
- **Linting/Formatting**: 
  - ESLint (Frontend)
  - Ruff (Backend)
- **Security**: Local-first credential encryption for API Keys.
