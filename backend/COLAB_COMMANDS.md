# Colab Backend Commands

조교가 GitHub에서 프로젝트를 받아 백엔드를 Colab으로 띄울 때 쓰는 최소 실행 순서입니다.

프론트엔드는 Netlify/GitHub Pages 등 정적 배포로 열고, 오디오 분석용 FastAPI 백엔드만 Colab에서 실행합니다. 스터디 종료 요약 로그는 프론트에서 Apps Script로 직접 `swai_segment` 탭에 저장합니다. Colab 백엔드는 주로 녹음 구간 STT, study/chat 판정, 구간 요약을 담당합니다.

## 0. Colab 런타임

상단 메뉴에서 다음처럼 설정합니다.

```text
런타임 > 런타임 유형 변경 > GPU > T4
```

GPU가 없거나 메모리가 부족하면 아래 환경변수에서 `HF_MODEL_ID`를 `Qwen/Qwen2.5-3B-Instruct`로 낮추거나, `ENABLE_HF_LLM`을 `false`로 바꾸면 됩니다.

## 1. GitHub에서 코드 받기

첫 실행:

```python
!git clone https://github.com/hedwigD/swai_project.git
%cd swai_project/backend
```

이미 Colab 런타임에 받아둔 폴더가 있으면:

```python
%cd /content/swai_project
!git pull
%cd backend
```

## 2. 패키지 설치

```python
!pip install -r requirements-colab.txt
```

설치가 오래 걸릴 수 있습니다. 특히 `openai-whisper`, `transformers`, `bitsandbytes` 설치 시간이 조금 걸립니다.

## 3. 환경변수 설정

아래 값 중 `APPS_SCRIPT_URL`, `NGROK_AUTHTOKEN`은 실제 값으로 바꿔 넣습니다.

```python
import os

# Google Apps Script Web App URL
os.environ["APPS_SCRIPT_URL"] = "YOUR_APPS_SCRIPT_EXEC_URL"

# Spreadsheet tab name
os.environ["SPREADSHEET_TABLE"] = "swai_segment"

# STT
os.environ["OPENAI_API_KEY"] = ""  # OpenAI STT를 쓸 때만 입력
os.environ["OPENAI_TRANSCRIBE_MODEL"] = "gpt-4o-mini-transcribe"
os.environ["STT_PROVIDER"] = "auto"
os.environ["LOCAL_STT_MODEL"] = "small"
os.environ["LOCAL_STT_LANGUAGE"] = "ko"
os.environ["LOCAL_STT_DEVICE"] = "auto"

# Audio save
os.environ["AUDIO_UPLOAD_DIR"] = "uploads"
os.environ["SAVE_AUDIO"] = "true"

# CORS
os.environ["CORS_ALLOW_ORIGINS"] = "*"

# LLM classification/summary
os.environ["ENABLE_HF_LLM"] = "true"
os.environ["HF_MODEL_ID"] = "Qwen/Qwen2.5-7B-Instruct"
os.environ["HF_LOAD_IN_4BIT"] = "true"
os.environ["HF_MAX_NEW_TOKENS"] = "180"
os.environ["HF_TEMPERATURE"] = "0.1"

# Optional Hugging Face token
# os.environ["HF_TOKEN"] = "YOUR_HUGGING_FACE_TOKEN"

# ngrok
os.environ["NGROK_AUTHTOKEN"] = "YOUR_NGROK_AUTHTOKEN"
```

## 4. 백엔드 실행

```python
from colab_runner import start_colab_backend

BACKEND_URL = start_colab_backend(port=8000)
BACKEND_URL
```

출력 예시:

```text
FastAPI backend URL: https://xxxx.ngrok-free.app
```

이 URL이 프론트에서 사용할 백엔드 URL입니다.

## 5. 동작 확인

```python
import requests

requests.get(f"{BACKEND_URL}/health").json()
```

선택 사항: 첫 업로드가 느리지 않도록 모델을 미리 로드합니다.

```python
import requests

print(requests.post(f"{BACKEND_URL}/load-stt").json())
print(requests.post(f"{BACKEND_URL}/load-llm").json())
```

선택 사항: Qwen 응답 테스트입니다.

```python
import requests

requests.post(
    f"{BACKEND_URL}/data",
    data={"data": "안녕, 지금 모델이 동작해?"}
).json()
```

## 6. 프론트와 연결

프론트 코드의 기본 백엔드 URL은 `js/app.js`의 `DEFAULT_BACKEND_URL`입니다. 조교가 직접 테스트할 때는 아래 중 하나로 연결합니다.

- 배포 전에 `DEFAULT_BACKEND_URL`을 Colab ngrok URL로 바꾼 뒤 프론트 배포
- 또는 브라우저 개발자 도구에서 임시로 앱 상태의 backend URL을 바꾸는 테스트용 코드 추가

현재 스터디 종료 요약 로그는 백엔드를 거치지 않고 Apps Script로 직접 저장됩니다. 따라서 종료 로그가 안 들어가면 Colab보다 Apps Script URL, Apps Script 배포 권한, `swai_segment` 탭 이름을 먼저 확인해야 합니다.

## 7. 자주 나는 문제

- `ngrok` URL이 열리지 않음: Colab 런타임이 꺼졌거나 백엔드 셀이 중단된 상태입니다. 4번 셀을 다시 실행합니다.
- `stt_status=failed`: Whisper 모델 로딩, ffmpeg, GPU 메모리를 확인합니다.
- `llm_status=hf_llm_unavailable`: GPU 메모리가 부족할 수 있습니다. `Qwen/Qwen2.5-3B-Instruct`로 낮추거나 `ENABLE_HF_LLM=false`로 테스트합니다.
- 종료 로그가 Google Sheet에 안 남음: `APPS_SCRIPT_URL`, Apps Script 배포 권한, `swai_segment` 탭 이름을 확인합니다.
- 구간 로그가 안 남음: Colab 환경변수 `SPREADSHEET_TABLE`이 `swai_segment`인지 확인합니다.
