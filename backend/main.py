import json
import os
import re
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
STT_PROVIDER = os.getenv("STT_PROVIDER", "auto").strip().lower()
TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
LOCAL_STT_MODEL = os.getenv("LOCAL_STT_MODEL", "small")
LOCAL_STT_LANGUAGE = os.getenv("LOCAL_STT_LANGUAGE", "ko")
LOCAL_STT_DEVICE = os.getenv("LOCAL_STT_DEVICE", "auto").strip().lower()
ENABLE_HF_LLM = os.getenv("ENABLE_HF_LLM", "false").lower() == "true"
HF_MODEL_ID = os.getenv("HF_MODEL_ID", "Qwen/Qwen2.5-7B-Instruct")
HF_TOKEN = os.getenv("HF_TOKEN") or None
HF_LOAD_IN_4BIT = os.getenv("HF_LOAD_IN_4BIT", "true").lower() == "true"
HF_MAX_NEW_TOKENS = int(os.getenv("HF_MAX_NEW_TOKENS", "180"))
HF_TEMPERATURE = float(os.getenv("HF_TEMPERATURE", "0.1"))

hf_pipeline = None
hf_tokenizer = None
hf_load_error = ""
local_stt_model = None
local_stt_device = ""
local_stt_load_error = ""

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
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("._")
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


def transcribe_with_openai(audio_path: Path) -> dict[str, Any]:
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


def resolve_local_stt_device() -> str:
    if LOCAL_STT_DEVICE != "auto":
        return LOCAL_STT_DEVICE

    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def load_local_stt_model() -> tuple[Any | None, str]:
    global local_stt_model, local_stt_device, local_stt_load_error

    if local_stt_model is not None:
        return local_stt_model, ""
    if local_stt_load_error:
        return None, local_stt_load_error

    try:
        import whisper

        local_stt_device = resolve_local_stt_device()
        local_stt_model = whisper.load_model(LOCAL_STT_MODEL, device=local_stt_device)
        return local_stt_model, ""
    except Exception as error:
        local_stt_load_error = str(error)
        return None, local_stt_load_error


def transcribe_with_local_whisper(audio_path: Path) -> dict[str, Any]:
    model, error = load_local_stt_model()
    model_name = f"local-whisper:{LOCAL_STT_MODEL}"
    if model is None:
        return {
            "transcript": "",
            "stt_status": "failed",
            "stt_model": model_name,
            "stt_error": error,
        }

    try:
        result = model.transcribe(
            str(audio_path),
            language=LOCAL_STT_LANGUAGE or None,
            fp16=local_stt_device == "cuda",
            verbose=False,
        )
        text = str(result.get("text", "")).strip()
        return {
            "transcript": text,
            "stt_status": "ok",
            "stt_model": model_name,
            "stt_error": "",
        }
    except Exception as error:
        return {
            "transcript": "",
            "stt_status": "failed",
            "stt_model": model_name,
            "stt_error": str(error),
        }


def transcribe_audio(audio_path: Path | None) -> dict[str, Any]:
    if audio_path is None:
        return {
            "transcript": "",
            "stt_status": "skipped",
            "stt_model": STT_PROVIDER,
            "stt_error": "audio file was not saved"
        }

    if STT_PROVIDER in {"disabled", "none", "off"}:
        return {
            "transcript": "",
            "stt_status": "disabled",
            "stt_model": "disabled",
            "stt_error": "STT_PROVIDER is disabled"
        }

    if STT_PROVIDER not in {"auto", "openai", "local_whisper", "whisper"}:
        return {
            "transcript": "",
            "stt_status": "failed",
            "stt_model": STT_PROVIDER,
            "stt_error": f"Unsupported STT_PROVIDER: {STT_PROVIDER}"
        }

    can_use_openai = bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None
    if STT_PROVIDER in {"auto", "openai"} and can_use_openai:
        openai_result = transcribe_with_openai(audio_path)
        if STT_PROVIDER == "openai" or openai_result["stt_status"] == "ok":
            return openai_result

    if STT_PROVIDER == "openai":
        reason = "OPENAI_API_KEY is not set" if not os.getenv("OPENAI_API_KEY") else "openai package is not installed"
        return {
            "transcript": "",
            "stt_status": "disabled",
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": reason
        }

    return transcribe_with_local_whisper(audio_path)


def extract_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def build_llm_prompt(transcript: str, metadata: dict[str, Any]) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "You classify Korean study-room audio transcripts. "
                "Return JSON only. Do not include markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "다음 스터디룸 음성 transcript와 보조 신호를 보고 구간을 분류해라.\n"
                "decision은 반드시 study 또는 chat 중 하나다.\n"
                "공부 내용, 문제 풀이, 설명, 과제, 코드, 발표 준비는 study다.\n"
                "사적인 대화, 음식, 게임, 농담, 딴 이야기, 휴식 대화는 chat이다.\n\n"
                "반드시 아래 JSON 형식만 출력해라:\n"
                "{\n"
                '  "decision": "study",\n'
                '  "reason": "짧은 한국어 이유",\n'
                '  "summary": "한 문장 요약"\n'
                "}\n\n"
                f"transcript: {transcript or '(empty)'}\n"
                f"average_volume: {metadata.get('average_volume', '')}\n"
                f"loud_ratio: {metadata.get('loud_ratio', '')}\n"
                f"frontend_decision: {metadata.get('frontend_decision', '')}\n"
            ),
        },
    ]

    if hf_tokenizer is not None and hasattr(hf_tokenizer, "apply_chat_template"):
        return hf_tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

    return "\n\n".join(f"{message['role']}: {message['content']}" for message in messages) + "\nassistant:"


def build_chat_prompt(message: str) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful Korean assistant for the SWAI study recorder project. "
                "Answer clearly and concisely in Korean."
            ),
        },
        {
            "role": "user",
            "content": message,
        },
    ]

    if hf_tokenizer is not None and hasattr(hf_tokenizer, "apply_chat_template"):
        return hf_tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

    return "\n\n".join(f"{message['role']}: {message['content']}" for message in messages) + "\nassistant:"


def load_hf_pipeline() -> tuple[Any | None, str]:
    global hf_pipeline, hf_tokenizer, hf_load_error

    if hf_pipeline is not None:
        return hf_pipeline, ""
    if hf_load_error:
        return None, hf_load_error

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, pipeline

        quantization_config = None
        if HF_LOAD_IN_4BIT:
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
            )

        hf_tokenizer = AutoTokenizer.from_pretrained(HF_MODEL_ID, token=HF_TOKEN)
        model = AutoModelForCausalLM.from_pretrained(
            HF_MODEL_ID,
            token=HF_TOKEN,
            device_map="auto",
            torch_dtype=torch.float16,
            quantization_config=quantization_config,
        )
        hf_pipeline = pipeline(
            "text-generation",
            model=model,
            tokenizer=hf_tokenizer,
            max_new_tokens=HF_MAX_NEW_TOKENS,
            temperature=HF_TEMPERATURE,
            do_sample=HF_TEMPERATURE > 0,
            return_full_text=False,
        )
        return hf_pipeline, ""
    except Exception as error:
        hf_load_error = str(error)
        return None, hf_load_error


def generate_hf_answer(message: str) -> dict[str, Any]:
    if not ENABLE_HF_LLM:
        return {
            "answer": "LLM이 비활성화되어 있습니다. ENABLE_HF_LLM=true로 설정한 뒤 서버를 다시 시작하세요.",
            "llm_status": "disabled",
            "llm_model": "",
        }

    pipe, error = load_hf_pipeline()
    if pipe is None:
        return {
            "answer": f"LLM을 사용할 수 없습니다: {error}",
            "llm_status": "hf_llm_unavailable",
            "llm_model": HF_MODEL_ID,
        }

    try:
        output = pipe(build_chat_prompt(message))
        answer = output[0].get("generated_text", "") if output else ""
        return {
            "answer": answer.strip(),
            "llm_status": "ok",
            "llm_model": HF_MODEL_ID,
        }
    except Exception as error:
        return {
            "answer": f"LLM 응답 생성에 실패했습니다: {error}",
            "llm_status": "hf_llm_failed",
            "llm_model": HF_MODEL_ID,
        }


def classify_segment_with_hf(transcript: str, metadata: dict[str, Any]) -> dict[str, Any] | None:
    if not ENABLE_HF_LLM:
        return None

    pipe, error = load_hf_pipeline()
    if pipe is None:
        return {
            "decision": "",
            "method": "hf_llm_unavailable",
            "reason": error,
            "summary": "",
        }

    try:
        prompt = build_llm_prompt(transcript, metadata)
        output = pipe(prompt)
        generated = output[0].get("generated_text", "") if output else ""
        parsed = extract_json_object(generated)
        if not parsed:
            return {
                "decision": "",
                "method": "hf_llm_parse_failed",
                "reason": generated[:300],
                "summary": "",
            }

        decision = str(parsed.get("decision", "")).strip().lower()
        if decision not in {"study", "chat"}:
            return {
                "decision": "",
                "method": "hf_llm_invalid_decision",
                "reason": json.dumps(parsed, ensure_ascii=False)[:300],
                "summary": "",
            }

        return {
            "decision": decision,
            "method": f"hf_llm:{HF_MODEL_ID}",
            "reason": str(parsed.get("reason", "")).strip(),
            "summary": str(parsed.get("summary", "")).strip(),
        }
    except Exception as error:
        return {
            "decision": "",
            "method": "hf_llm_failed",
            "reason": str(error),
            "summary": "",
        }


def attach_llm_metadata(
    result: dict[str, Any],
    llm_result: dict[str, Any] | None,
) -> dict[str, Any]:
    if llm_result is None:
        result.update({
            "llm_enabled": ENABLE_HF_LLM,
            "llm_model": HF_MODEL_ID if ENABLE_HF_LLM else "",
            "llm_status": "disabled" if not ENABLE_HF_LLM else "not_run",
            "llm_summary": "",
            "llm_reason": "",
        })
        return result

    result.update({
        "llm_enabled": ENABLE_HF_LLM,
        "llm_model": HF_MODEL_ID,
        "llm_status": "ok" if llm_result.get("decision") in {"study", "chat"} else llm_result.get("method", "failed"),
        "llm_summary": llm_result.get("summary", ""),
        "llm_reason": llm_result.get("reason", ""),
    })
    return result


def classify_segment(transcript: str, metadata: dict[str, Any]) -> dict[str, Any]:
    llm_result = classify_segment_with_hf(transcript, metadata)
    if llm_result and llm_result.get("decision") in {"study", "chat"}:
        return attach_llm_metadata(llm_result, llm_result)

    text = transcript.lower()
    study_words = [
        "\uacf5\ubd80", "\ubb38\uc81c", "\ud480\uc774", "\uc815\ub9ac",
        "\uac1c\ub150", "\uc54c\uace0\ub9ac\uc998", "\ucf54\ub4dc", "\uad6c\ud604",
        "\uacfc\uc81c", "\uc2dc\ud5d8", "\ubcf5\uc2b5", "\uc124\uba85",
        "\uc790\ub8cc", "\ubc1c\ud45c", "\ud568\uc218", "\ub370\uc774\ud130"
    ]
    chat_words = [
        "\uc7a1\ub2f4", "\ubc25", "\uce74\ud398", "\uac8c\uc784",
        "\uc720\ud29c\ube0c", "\uc601\ud654", "\uc8fc\ub9d0", "\ub180\uc790",
        "\uc220", "\ub9db\uc9d1", "\u314b\u314b", "\ud558\ud558",
        "\uc7ac\ubc0c", "\uc878\ub824", "\uc9d1\uc5d0"
    ]

    study_hits = [word for word in study_words if word in text]
    chat_hits = [word for word in chat_words if word in text]

    if transcript and len(chat_hits) > len(study_hits):
        return attach_llm_metadata({
            "decision": "chat",
            "method": "transcript_keyword",
            "reason": f"chat keywords: {', '.join(chat_hits)}"
        }, llm_result)

    if transcript and study_hits:
        return attach_llm_metadata({
            "decision": "study",
            "method": "transcript_keyword",
            "reason": f"study keywords: {', '.join(study_hits)}"
        }, llm_result)

    frontend_decision = str(metadata.get("frontend_decision") or "").strip()
    if frontend_decision in {"study", "chat"}:
        return attach_llm_metadata({
            "decision": frontend_decision,
            "method": "frontend_volume_fallback",
            "reason": "used frontend volume-based decision"
        }, llm_result)

    average_volume = float(metadata.get("average_volume") or 0)
    loud_ratio = float(metadata.get("loud_ratio") or 0)
    decision = "chat" if average_volume >= 13 or loud_ratio >= 0.24 else "study"
    return attach_llm_metadata({
        "decision": decision,
        "method": "backend_volume_fallback",
        "reason": f"average_volume={average_volume}, loud_ratio={loud_ratio}"
    }, llm_result)


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


def effective_stt_model_name() -> str:
    if STT_PROVIDER in {"disabled", "none", "off"}:
        return "disabled"
    if STT_PROVIDER == "openai":
        return TRANSCRIBE_MODEL
    if STT_PROVIDER == "auto" and bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None:
        return TRANSCRIBE_MODEL
    return f"local-whisper:{LOCAL_STT_MODEL}"


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "app": APP_NAME,
        "stt_enabled": STT_PROVIDER not in {"disabled", "none", "off"},
        "stt_provider": STT_PROVIDER,
        "stt_model": effective_stt_model_name(),
        "openai_stt_enabled": bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None,
        "local_stt_model": LOCAL_STT_MODEL,
        "local_stt_language": LOCAL_STT_LANGUAGE,
        "local_stt_device": local_stt_device or LOCAL_STT_DEVICE,
        "local_stt_loaded": local_stt_model is not None,
        "local_stt_load_error": local_stt_load_error,
        "hf_llm_enabled": ENABLE_HF_LLM,
        "hf_model_id": HF_MODEL_ID,
        "hf_load_in_4bit": HF_LOAD_IN_4BIT,
        "hf_loaded": hf_pipeline is not None,
        "hf_load_error": hf_load_error,
        "save_audio": SAVE_AUDIO,
        "upload_dir": str(UPLOAD_DIR),
    }


@app.get("/load-stt")
@app.post("/load-stt")
async def load_stt() -> dict[str, Any]:
    if STT_PROVIDER in {"disabled", "none", "off"}:
        return {
            "status": "disabled",
            "stt_provider": STT_PROVIDER,
        }

    if STT_PROVIDER == "openai":
        return {
            "status": "ok" if bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None else "disabled",
            "stt_provider": STT_PROVIDER,
            "stt_model": TRANSCRIBE_MODEL,
            "stt_error": "" if bool(os.getenv("OPENAI_API_KEY")) and OpenAI is not None else "OPENAI_API_KEY or openai package is missing",
        }

    model, error = load_local_stt_model()
    return {
        "status": "ok" if model is not None else "failed",
        "stt_provider": STT_PROVIDER,
        "stt_model": f"local-whisper:{LOCAL_STT_MODEL}",
        "local_stt_language": LOCAL_STT_LANGUAGE,
        "local_stt_device": local_stt_device or LOCAL_STT_DEVICE,
        "local_stt_loaded": model is not None,
        "local_stt_load_error": error,
    }


@app.get("/load-llm")
@app.post("/load-llm")
async def load_llm() -> dict[str, Any]:
    if not ENABLE_HF_LLM:
        return {
            "status": "disabled",
            "hf_llm_enabled": False,
            "hf_model_id": HF_MODEL_ID,
        }

    pipe, error = load_hf_pipeline()
    return {
        "status": "ok" if pipe is not None else "failed",
        "hf_llm_enabled": True,
        "hf_model_id": HF_MODEL_ID,
        "hf_load_in_4bit": HF_LOAD_IN_4BIT,
        "hf_loaded": pipe is not None,
        "hf_load_error": error,
    }


@app.post("/data")
async def bonus_chat(data: str = Form(...)) -> dict[str, Any]:
    return generate_hf_answer(data)


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
        "llm_enabled": classification.get("llm_enabled", False),
        "llm_model": classification.get("llm_model", ""),
        "llm_status": classification.get("llm_status", ""),
        "llm_summary": classification.get("llm_summary", ""),
        "llm_reason": classification.get("llm_reason", ""),
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
        "llm_enabled": classification.get("llm_enabled", False),
        "llm_model": classification.get("llm_model", ""),
        "llm_status": classification.get("llm_status", ""),
        "llm_summary": classification.get("llm_summary", ""),
        "llm_reason": classification.get("llm_reason", ""),
        "audio_saved_path": str(audio_path) if audio_path else "",
        **spreadsheet_result,
    }
