# ─────────────────────────────────────────────────────────────────────────────
# AgentHive Engine — Production Dockerfile
# Multi-stage build: minimise image size, no dev tools in final layer.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

# Install build essentials needed for some C-extension wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Poetry
ENV POETRY_VERSION=1.8.3
ENV POETRY_HOME=/opt/poetry
ENV POETRY_VIRTUALENVS_IN_PROJECT=true
ENV POETRY_NO_INTERACTION=1
RUN curl -sSL https://install.python-poetry.org | python3 -

ENV PATH="$POETRY_HOME/bin:$PATH"

WORKDIR /app
COPY pyproject.toml poetry.lock ./

# Install production dependencies only (no dev)
RUN poetry install --only main --no-root

# Copy source
COPY . .

# ── Stage 2: final runtime ─────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN adduser --disabled-password --gecos '' appuser

WORKDIR /app

# Copy the pre-built virtual environment
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy application source
COPY --from=builder /app/app ./app
COPY --from=builder /app/main.py ./main.py

# Create workspace directory
RUN mkdir -p /workspace && chown appuser:appuser /workspace

USER appuser

# Health & metadata
EXPOSE 8000
LABEL org.opencontainers.image.title="AgentHive Engine"
LABEL org.opencontainers.image.description="Model-Agnostic Multi-Agent Execution Engine"
LABEL org.opencontainers.image.version="0.5.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--loop", "uvloop", "--log-level", "info"]
