# SWAI FastAPI Backend

This backend receives audio segments from the frontend, optionally transcribes them with OpenAI STT, classifies each segment as `study` or `chat`, can use a Hugging Face LLM such as Qwen2.5 for classification/summary, and appends the result to Google Spreadsheet through the existing Apps Script endpoint.

## Recommended: Run In Colab

Use `COLAB_SETUP.md` when you want to run FastAPI in Google Colab and expose it with ngrok.

Short version:

```python
!git clone https://github.com/hedwigD/swai_project.git
%cd swai_project/backend
!pip install -r requirements-colab.txt
```

Then set environment variables and run:

```python
import os

os.environ["ENABLE_HF_LLM"] = "true"
os.environ["HF_MODEL_ID"] = "Qwen/Qwen2.5-7B-Instruct"
os.environ["HF_LOAD_IN_4BIT"] = "true"

from colab_runner import start_colab_backend
BACKEND_URL = start_colab_backend(port=8000)
```

Paste the printed ngrok URL into the frontend backend URL field.

Qwen2.5 is downloaded by Hugging Face automatically inside the Colab runtime. You do not need to download the model manually.

## Local Run

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

If `OPENAI_API_KEY` is empty, the backend still receives and saves audio, but STT is skipped. In that case Qwen2.5 has no transcript to read, so classification falls back to the frontend volume decision.

If `ENABLE_HF_LLM=false`, the backend skips Qwen2.5 and uses transcript keywords or volume fallback.

## Endpoints

- `GET /health`
- `GET/POST /load-llm`
- `POST /data`
- `POST /event`
- `POST /audio-segment`

`/audio-segment` expects multipart form data:

- `audio`: audio file
- `request`: JSON metadata string

`/data` is compatible with the bonus `llm_chat.html` example. It expects form data named `data` and returns `{ "answer": "..." }`.
