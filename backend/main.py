import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


load_dotenv()

APP_NAME = "SWAI Study Recorder Backend"
UPLOAD_DIR = Path(os.getenv("AUDIO_UPLOAD_DIR", "uploads"))
SAVE_AUDIO = os.getenv("SAVE_AUDIO", "true").lower() != "false"
DEFAULT_SHEET_NAME = os.getenv("SPREADSHEET_TABLE", "swai_segments")
DEFAULT_APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")
TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")

app = FastAPI(title=APP_NAME)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EventPayload(BaseModel):
    event: str
    metadata: dict[str, Any] = {}


def now_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def sanitize_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9가-힣_.-]+", "_", value).strip("._")
    return cleaned or "audio"


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def parse_request_json(request_text: str) -> dict[str, Any]:
    try:
        data = json.loads(request_text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def public_record(metadata: dict[str, Any]) -> dict[str, Any]:
    record = dict(metadata)
    record.pop("apps_script_url", None)
    record.pop("sheet_name", None)
    return record


async def save_upload(audio: UploadFile, metadata: dict[str, Any]) -> tuple[Path | None, int]:
    contents = await audio.read()
    size = len(contents)
    if not SAVE_AUDIO:
        return None, size

    session_id = sanitize_filename(str(metadata.get("session_id", "session")))
    segment_index = sanitize_filename(str(metadata.get("segment_index", "0")))
    original_name = sanitize_filename(audio.filename or f"segment-{segment_index}.webm")
    target_dir = UPLOAD_DIR / session_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{segment_index}-{original_name}"

    with target_path.open("wb") as file:
        file.write(contents)

    return target_path, size


def transcribe_audio(audio_path: Path | None) -> dict[str, Any]:
    if audio_path is None:
        return {
            "transcript": "",
            "stt_status": "skipped",
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": "audio file was not saved"
        }

    if not os.getenv("OPENAI_API_KEY"):
        return {
            "transcript": "",
            "stt_status": "disabled",
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": "OPENAI_API_KEY is not set"
        }

    if OpenAI is None:
        return {
            "transcript": "",
            "stt_status": "disabled",
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": "openai package is not installed"
        }

    try:
        client = OpenAI()
        with audio_path.open("rb") as file:
            transcription = client.audio.transcriptions.create(
                model=TRANSCRIBE_MODEL,
                file=file,
            )
        text = getattr(transcription, "text", "") or ""
        return {
            "transcript": text.strip(),
            "stt_status": "ok",
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": ""
        }
    except Exception as error:
        return {
            "transcript": "",
            "stt_status": "failed",
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": str(error)
        }


def classify_segment(transcript: str, metadata: dict[str, Any]) -> dict[str, str]:
    text = transcript.lower()
    study_words = [
        "공부", "문제", "풀이", "정리", "개념", "알고리즘", "코드", "구현",
        "과제", "시험", "복습", "설명", "자료", "발표", "함수", "데이터"
    ]
    chat_words = [
        "잡담", "밥", "카페", "게임", "유튜브", "영화", "주말", "놀자",
        "술", "맛집", "ㅋㅋ", "하하", "재밌", "졸려", "집에"
    ]

    study_hits = [word for word in study_words if word in text]
    chat_hits = [word for word in chat_words if word in text]

    if transcript and len(chat_hits) > len(study_hits):
        return {
            "decision": "chat",
            "method": "transcript_keyword",
            "reason": f"chat keywords: {', '.join(chat_hits)}"
        }

    if transcript and study_hits:
        return {
            "decision": "study",
            "method": "transcript_keyword",
            "reason": f"study keywords: {', '.join(study_hits)}"
        }

    frontend_decision = str(metadata.get("frontend_decision") or "").strip()
    if frontend_decision in {"study", "chat"}:
        return {
            "decision": frontend_decision,
            "method": "frontend_volume_fallback",
            "reason": "used frontend volume-based decision"
        }

    average_volume = float(metadata.get("average_volume") or 0)
    loud_ratio = float(metadata.get("loud_ratio") or 0)
    decision = "chat" if average_volume >= 13 or loud_ratio >= 0.24 else "study"
    return {
        "decision": decision,
        "method": "backend_volume_fallback",
        "reason": f"average_volume={average_volume}, loud_ratio={loud_ratio}"
    }


async def append_to_spreadsheet(record: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    apps_script_url = metadata.get("apps_script_url") or DEFAULT_APPS_SCRIPT_URL
    sheet_name = metadata.get("sheet_name") or DEFAULT_SHEET_NAME

    if not apps_script_url:
        return {
            "spreadsheet_status": "skipped",
            "spreadsheet_error": "Apps Script URL is not configured"
        }

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(
                apps_script_url,
                params={
                    "action": "insert",
                    "table": sheet_name,
                    "data": json.dumps(record, ensure_ascii=False),
                },
            )
        return {
            "spreadsheet_status": "ok" if response.is_success else "failed",
            "spreadsheet_status_code": response.status_code,
            "spreadsheet_error": "" if response.is_success else response.text[:300],
        }
    except Exception as error:
        return {
            "spreadsheet_status": "failed",
            "spreadsheet_error": str(error)
        }


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "app": APP_NAME,
        "stt_enabled": bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None,
        "stt_model": TRANSCRIBE_MODEL,
        "save_audio": SAVE_AUDIO,
        "upload_dir": str(UPLOAD_DIR),
    }


@app.post("/event")
async def record_event(payload: EventPayload, request: Request) -> dict[str, Any]:
    metadata = dict(payload.metadata)
    metadata["event"] = payload.event
    metadata["backend_received_at"] = now_stamp()
    metadata["backend_client_ip"] = get_client_ip(request)

    record = public_record(metadata)
    spreadsheet_result = await append_to_spreadsheet(record, metadata)
    return {
        "status": "ok",
        "event": payload.event,
        **spreadsheet_result,
    }


@app.post("/audio-segment")
async def audio_segment(
    request: Request,
    audio: UploadFile = File(...),
    request_text: str = Form(..., alias="request"),
) -> dict[str, Any]:
    metadata = parse_request_json(request_text)
    metadata["event"] = metadata.get("event") or "segment_recorded"
    metadata["backend_received_at"] = now_stamp()
    metadata["backend_client_ip"] = get_client_ip(request)
    metadata["audio_file_name"] = audio.filename or ""

    audio_path, audio_size = await save_upload(audio, metadata)
    metadata["audio_size_bytes"] = metadata.get("audio_size_bytes") or audio_size
    metadata["audio_saved_path"] = str(audio_path) if audio_path else ""

    stt_result = transcribe_audio(audio_path)
    classification = classify_segment(stt_result["transcript"], metadata)

    speaker = metadata.get("frontend_speaker") or ""
    if classification["decision"] == "study":
        speaker = ""

    record = {
        **public_record(metadata),
        "transcript": stt_result["transcript"],
        "stt_status": stt_result["stt_status"],
        "stt_model": stt_result["stt_model"],
        "stt_error": stt_result["stt_error"],
        "decision": classification["decision"],
        "speaker": speaker,
        "classification_method": classification["method"],
        "classification_reason": classification["reason"],
    }
    spreadsheet_result = await append_to_spreadsheet(record, metadata)

    return {
        "status": "ok",
        "decision": classification["decision"],
        "speaker": speaker,
        "transcript": stt_result["transcript"],
        "stt_status": stt_result["stt_status"],
        "stt_model": stt_result["stt_model"],
        "classification_method": classification["method"],
        "classification_reason": classification["reason"],
        "audio_saved_path": str(audio_path) if audio_path else "",
        **spreadsheet_result,
    }
