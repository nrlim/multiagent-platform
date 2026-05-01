import asyncio
import os
from app import config
from app.db import db_get_system_settings, disconnect_db
import httpx

async def main():
    print("Fetching settings from DB...")
    try:
        db_config = await db_get_system_settings()
        kimi_key = db_config.get("kimi_key") or config.KIMI_API_KEY
    except Exception as e:
        print(f"Could not connect to DB: {e}")
        kimi_key = config.KIMI_API_KEY

    if not kimi_key:
        print("Error: KIMI_API_KEY is not set in DB or .env")
        return

    print(f"Key loaded: {kimi_key[:8]}... (length: {len(kimi_key)})")

    url = "https://api.moonshot.ai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {kimi_key}",
        "Content-Type": "application/json"
    }
    data = {
        "model": "kimi-k2.6",
        "messages": [{"role": "user", "content": "Test ping"}],
        "temperature": 0.7
    }

    print(f"Calling {url}...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=data)
            print(f"Status: {resp.status_code}")
            print(f"Response: {resp.text}")
    except Exception as e:
        print(f"Direct request failed: {e}")

    await disconnect_db()

if __name__ == "__main__":
    asyncio.run(main())
