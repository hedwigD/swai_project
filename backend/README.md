# SWAI FastAPI Backend

This backend receives audio segments from the frontend, optionally transcribes them with OpenAI STT, classifies each segment as `study` or `chat`, and appends the result to Google Spreadsheet through the existing Apps Script endpoint.

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Fill `.env`:

```text
OPENAI_API_KEY=your_openai_api_key
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
SPREADSHEET_TABLE=swai_segments
```

If `OPENAI_API_KEY` is empty, the backend still receives and saves audio, but STT is skipped and classification falls back to the frontend volume decision.

## Run

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Frontend default backend URL:

```text
http://127.0.0.1:8000
```

## Endpoints

- `GET /health`
- `POST /event`
- `POST /audio-segment`

`/audio-segment` expects multipart form data:

- `audio`: audio file
- `request`: JSON metadata string
