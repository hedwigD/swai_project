# Colab FastAPI Backend Setup

Use this when the frontend runs on your PC, but the FastAPI backend runs in Google Colab.

## 1. Clone and Install

Run this in a Colab code cell:

```python
!git clone https://github.com/hedwigD/swai_project.git
%cd swai_project/backend
!pip install -r requirements-colab.txt
```

If the repo already exists in the Colab runtime:

```python
%cd /content/swai_project
!git pull
%cd backend
!pip install -r requirements-colab.txt
```

## 2. Set Environment Variables

Run this in another Colab code cell:

```python
import os

os.environ["OPENAI_API_KEY"] = "YOUR_OPENAI_API_KEY"
os.environ["APPS_SCRIPT_URL"] = "YOUR_APPS_SCRIPT_EXEC_URL"
os.environ["SPREADSHEET_TABLE"] = "swai_segments"
os.environ["OPENAI_TRANSCRIBE_MODEL"] = "gpt-4o-mini-transcribe"
os.environ["AUDIO_UPLOAD_DIR"] = "uploads"
os.environ["SAVE_AUDIO"] = "true"
os.environ["CORS_ALLOW_ORIGINS"] = "*"

# Recommended for stable ngrok use.
os.environ["NGROK_AUTHTOKEN"] = "YOUR_NGROK_AUTHTOKEN"
```

`OPENAI_API_KEY` can be left blank for a fallback demo. In that case, audio upload and spreadsheet logging work, but STT is skipped.

## 3. Start FastAPI and ngrok

Run:

```python
from colab_runner import start_colab_backend

BACKEND_URL = start_colab_backend(port=8000)
BACKEND_URL
```

Colab prints a URL like:

```text
https://xxxx.ngrok-free.app
```

Copy that URL.

## 4. Run the Frontend

On your PC, from the project root:

```powershell
python -m http.server 8010 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8010/
```

Paste the Colab ngrok URL into:

```text
FastAPI 백엔드 URL (Colab ngrok URL)
```

Then start the study session.

## What Works

- Frontend records real audio in the browser.
- Audio Blob is sent to the Colab FastAPI backend.
- Colab saves the uploaded audio under `backend/uploads`.
- If `OPENAI_API_KEY` is set, Colab runs STT and returns `transcript`.
- Backend classifies the segment as `study` or `chat`.
- Backend appends records to Google Spreadsheet through Apps Script.

## Common Issues

- If the frontend says backend upload failed, check that the Colab runtime is still alive.
- If `/health` does not open at the ngrok URL, restart the Colab backend cell.
- If `stt_status=disabled`, `OPENAI_API_KEY` is missing or blank.
- If spreadsheet logging fails, check `APPS_SCRIPT_URL` and Apps Script deployment permissions.
