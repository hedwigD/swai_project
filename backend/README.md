# SWAI FastAPI Backend

This backend receives audio segments from the frontend, optionally transcribes them with OpenAI STT, classifies each segment as `study` or `chat`, and appends the result to Google Spreadsheet through the existing Apps Script endpoint.

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
from colab_runner import start_colab_backend
BACKEND_URL = start_colab_backend(port=8000)
```

Paste the printed ngrok URL into the frontend backend URL field.

## Local Run

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

If `OPENAI_API_KEY` is empty, the backend still receives and saves audio, but STT is skipped and classification falls back to the frontend volume decision.

## Endpoints

- `GET /health`
- `POST /event`
- `POST /audio-segment`

`/audio-segment` expects multipart form data:

- `audio`: audio file
- `request`: JSON metadata string
