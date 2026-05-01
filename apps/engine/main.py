"""AgentHive Engine - Development entrypoint"""
import uvicorn
from app import config

import sys
import asyncio
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.ENGINE_HOST,
        port=config.ENGINE_PORT,
        reload=True,
        log_level="info",
    )
