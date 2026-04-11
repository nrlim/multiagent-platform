"""AgentHive Engine - Development entrypoint"""
import uvicorn
from app import config

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.ENGINE_HOST,
        port=config.ENGINE_PORT,
        reload=True,
        log_level="info",
    )
