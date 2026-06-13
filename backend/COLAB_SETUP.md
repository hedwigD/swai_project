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
os.environ["SPREADSHEET_TABLE"] = "swai_segment"
os.environ["OPENAI_TRANSCRIBE_MODEL"] = "gpt-4o-mini-transcribe"
os.environ["STT_PROVIDER"] = "auto"
os.environ["LOCAL_STT_MODEL"] = "small"
os.environ["LOCAL_STT_LANGUAGE"] = "ko"
os.environ["LOCAL_STT_DEVICE"] = "auto"
os.environ["AUDIO_UPLOAD_DIR"] = "uploads"
os.environ["SAVE_AUDIO"] = "true"
os.environ["CORS_ALLOW_ORIGINS"] = "*"

# Qwen2.5 LLM classification and summary.
os.environ["ENABLE_HF_LLM"] = "true"
os.environ["HF_MODEL_ID"] = "Qwen/Qwen2.5-7B-Instruct"
os.environ["HF_LOAD_IN_4BIT"] = "true"
os.environ["HF_MAX_NEW_TOKENS"] = "180"
os.environ["HF_TEMPERATURE"] = "0.1"

# Optional. Uncomment only when Hugging Face asks for authentication or rate limits you.
# os.environ["HF_TOKEN"] = "YOUR_HUGGING_FACE_TOKEN"

# Recommended for stable ngrok use.
os.environ["NGROK_AUTHTOKEN"] = "YOUR_NGROK_AUTHTOKEN"
```

`OPENAI_API_KEY` can be left blank. With `STT_PROVIDER=auto`, the backend uses local Whisper in Colab when there is no OpenAI API key.

For the Qwen2.5 and local Whisper demo, use a Colab GPU runtime. A T4 GPU with 4-bit Qwen loading is the target setup. If model loading runs out of memory, set `HF_MODEL_ID` to `Qwen/Qwen2.5-3B-Instruct` or set `LOCAL_STT_MODEL` to `base`.

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

Optional warm-up cell:

```python
import requests

requests.post(f"{BACKEND_URL}/load-stt").json()
requests.post(f"{BACKEND_URL}/load-llm").json()
```

The warm-up cell downloads and loads local Whisper and Qwen2.5 before the first real audio upload. Without this, the first uploaded segment may take a while because it triggers the model load.

Optional bonus chat test:

```python
import requests

requests.post(f"{BACKEND_URL}/data", data={"data": "안녕, 지금 모델이 동작해?"}).json()
```

The response should contain an `answer` field. This is the same shape used by `dev/bonus/llm_chat.html`.

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
- If `OPENAI_API_KEY` is set, Colab can use OpenAI STT.
- If `OPENAI_API_KEY` is blank and `STT_PROVIDER=auto`, Colab uses local Whisper STT and returns `transcript`.
- If `ENABLE_HF_LLM=true`, Backend sends the transcript to Qwen2.5 for `study`/`chat` classification and one-line summary.
- If Qwen2.5 is disabled or fails, Backend falls back to keyword/volume classification.
- The bonus `/data` endpoint can return a plain Qwen2.5 chat response for `llm_chat.html`.
- Backend appends records to Google Spreadsheet through Apps Script.

## Common Issues

- If the frontend says backend upload failed, check that the Colab runtime is still alive.
- If `/health` does not open at the ngrok URL, restart the Colab backend cell.
- If `stt_status=failed`, check local Whisper model loading, ffmpeg, and GPU memory.
- If `llm_status=hf_llm_unavailable`, check Colab GPU memory, Hugging Face token, and whether `transformers`, `accelerate`, and `bitsandbytes` installed correctly.
- If spreadsheet logging fails, check `APPS_SCRIPT_URL` and Apps Script deployment permissions.
