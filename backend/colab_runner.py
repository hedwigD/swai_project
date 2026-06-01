import os
from threading import Thread

import nest_asyncio
import uvicorn
from pyngrok import ngrok


def start_colab_backend(port: int = 8000) -> str:
    token = os.getenv("NGROK_AUTHTOKEN", "").strip()
    if token:
        ngrok.set_auth_token(token)

    ngrok.kill()
    nest_asyncio.apply()

    public_url = ngrok.connect(port, bind_tls=True).public_url
    print(f"FastAPI backend URL: {public_url}")
    print("Paste this URL into the frontend Backend URL field.")

    def run_server() -> None:
        uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")

    thread = Thread(target=run_server, daemon=True)
    thread.start()
    return public_url


if __name__ == "__main__":
    start_colab_backend()
