const DEFAULT_BACKEND_URL = "https://pardon-ion-brute.ngrok-free.dev";
const DEFAULT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyUIBCtr6azQwxAMGdEAiVQIcX1yvQWHdfVs41lViRHPNBbxi7PHiLw6vdjT2iwZlqK/exec";
const DEFAULT_SHEET_NAME = "swai_segment";

const state = {
  roomName: "",
  backendUrl: DEFAULT_BACKEND_URL,
  appsScriptUrl: DEFAULT_APPS_SCRIPT_URL,
  sheetName: DEFAULT_SHEET_NAME,
  sessionId: "",
  userId: "",
  userIp: "unknown",
  participants: ["민수", "지윤", "서연"],
  activeSpeaker: "민수",
  segmentSeconds: 20,
  startedAt: null,
  stream: null,
  recorder: null,
  audioContext: null,
  analyser: null,
  meterTimer: null,
  boardTimer: null,
  segmentTimer: null,
  segmentStartedAt: null,
  recorderSkipSave: false,
  chunks: [],
  volumeSamples: [],
  segments: [],
  pendingUploads: [],
  isPaused: false
};

const $ = (selector) => document.querySelector(selector);
const participantsEl = $("#participants");
const speakerButtonsEl = $("#speakerButtons");
const decisionFeedEl = $("#decisionFeed");
const segmentModalEl = $("#segmentModal");
const modalBadgeEl = $("#modalBadge");
const modalTitleEl = $("#modalTitle");
const modalBodyEl = $("#modalBody");

function pad(value) {
  return String(value).padStart(2, "0");
}

function getTimeStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
}

function getCookieValue(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return "";
}

function setCookieValue(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
}

function getUserId() {
  const existing = getCookieValue("swai_user");
  if (existing) return existing;

  const generated = `SWAI-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  setCookieValue("swai_user", generated, 180);
  return generated;
}

function getDeviceType() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    ? "mobile"
    : "desktop";
}

async function loadUserIp() {
  try {
    const response = await fetch("https://jsonip.com?format=json");
    const json = await response.json();
    state.userIp = json.ip || "unknown";
  } catch (error) {
    state.userIp = "unknown";
  }
}

function setStatus(text, live = false) {
  $("#systemStatus").textContent = text;
  $("#liveDot").classList.toggle("live", live);
}

function cleanBackendUrl() {
  return state.backendUrl.replace(/\/$/, "");
}

function buildBaseRecord(eventName) {
  const params = new URLSearchParams(window.location.search);
  return {
    event: eventName,
    id: state.userId,
    session_id: state.sessionId,
    room_name: state.roomName,
    landingUrl: window.location.href,
    frontend_ip: state.userIp,
    referer: document.referrer,
    time_stamp: getTimeStamp(),
    utm: params.get("utm") || "",
    device: getDeviceType(),
    user_agent: navigator.userAgent,
    participant_count: state.participants.length,
    participants: state.participants.join(", "),
    apps_script_url: state.appsScriptUrl,
    sheet_name: state.sheetName
  };
}

function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `swaiJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
      clearTimeout(timeout);
    };
    const query = new URLSearchParams({
      ...params,
      callback: callbackName
    });
    const separator = url.includes("?") ? "&" : "?";
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Apps Script 응답 시간 초과"));
    }, 12000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Apps Script 요청 실패"));
    };
    script.src = `${url}${separator}${query.toString()}`;
    document.body.appendChild(script);
  });
}

function isSpreadsheetSaved(result) {
  if (!result.ok) return false;
  const spreadsheetStatus = result.data?.spreadsheet_status;
  if (spreadsheetStatus) return spreadsheetStatus === "ok";
  if (result.data?.status) return !["failed", "error"].includes(String(result.data.status).toLowerCase());
  if (result.data?.ok === false || result.data?.success === false) return false;
  return true;
}

function buildCompactSummaryRecord(summaryFields) {
  const baseRecord = buildBaseRecord("session_finished");
  return {
    event: "session_finished",
    time_stamp: baseRecord.time_stamp,
    session_id: baseRecord.session_id,
    room_name: baseRecord.room_name,
    user_ip: summaryFields.user_ip || baseRecord.frontend_ip,
    user_name: summaryFields.user_name || baseRecord.participants,
    operation_time: summaryFields.operation_time,
    pure_study_time: summaryFields.pure_study_time,
    chat_duration: summaryFields.chat_duration,
    top_speaker: summaryFields.top_speaker,
    chat_summary: summaryFields.chat_summary
  };
}

async function insertSummaryDirectly(summaryRecord) {
  if (!state.appsScriptUrl) {
    return { ok: false, status: "Apps Script URL 미설정" };
  }

  try {
    const data = await jsonpRequest(state.appsScriptUrl, {
      action: "insert",
      table: state.sheetName,
      data: JSON.stringify(summaryRecord)
    });

    return { ok: true, status: "Apps Script 직접 저장 완료", data };
  } catch (error) {
    return { ok: false, status: `Apps Script 직접 저장 실패: ${error.message}`, error };
  }
}

async function sendBackendEvent(eventName, payload = {}) {
  if (!state.backendUrl) return { ok: false, status: "백엔드 미설정" };

  try {
    const response = await fetch(`${cleanBackendUrl()}/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true"
      },
      body: JSON.stringify({
        event: eventName,
        metadata: {
          ...buildBaseRecord(eventName),
          ...payload
        }
      })
    });
    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : {};
    return {
      ok: response.ok,
      status: data.spreadsheet_status || data.status || `HTTP ${response.status}`,
      data
    };
  } catch (error) {
    return { ok: false, status: `백엔드 전송 실패: ${error.message}`, error };
  }
}

function renderParticipants() {
  participantsEl.innerHTML = "";

  state.participants.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "chip";

    const label = document.createElement("span");
    label.textContent = name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.setAttribute("aria-label", `${name} 삭제`);
    remove.addEventListener("click", () => {
      state.participants = state.participants.filter((item) => item !== name);
      if (state.activeSpeaker === name) state.activeSpeaker = state.participants[0] || "";
      renderParticipants();
    });

    chip.append(label, remove);
    participantsEl.appendChild(chip);
  });
}

function renderSpeakerButtons() {
  speakerButtonsEl.innerHTML = "";

  state.participants.forEach((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", state.activeSpeaker === name);
    button.addEventListener("click", () => {
      state.activeSpeaker = name;
      renderSpeakerButtons();
    });
    speakerButtonsEl.appendChild(button);
  });
}

function updateBoard() {
  const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
  const studyMs = state.segments
    .filter((segment) => segment.decision === "study")
    .reduce((sum, segment) => sum + segment.durationMs, 0);
  const last = state.segments[state.segments.length - 1];

  $("#totalTime").textContent = formatDuration(elapsed);
  $("#studyTime").textContent = formatDuration(studyMs);
  $("#lastDecision").textContent = last ? (last.decision === "study" ? "공부" : "잡담") : "녹음 중";
  $("#lastSpeaker").textContent = last?.speaker || "-";
}

function getAverageVolume(samples) {
  if (!samples.length) return 0;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function truncateText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildSpeakerBreakdown(chatSegments) {
  const totals = chatSegments.reduce((map, segment) => {
    const speaker = segment.speaker || "발화자 미선택";
    if (!map[speaker]) {
      map[speaker] = { count: 0, durationMs: 0 };
    }
    map[speaker].count += 1;
    map[speaker].durationMs += segment.durationMs;
    return map;
  }, {});

  return Object.entries(totals)
    .sort((a, b) => b[1].durationMs - a[1].durationMs)
    .map(([speaker, info]) => `${speaker}: ${info.count}회/${formatDuration(info.durationMs)}`)
    .join(", ");
}

function buildChatSummary(chatSegments) {
  if (!chatSegments.length) {
    return "잡담으로 판정된 구간이 없습니다.";
  }

  const topicSnippets = chatSegments
    .map((segment) => segment.llmSummary || segment.transcript || segment.classificationReason || "")
    .map((text) => truncateText(text, 90))
    .filter(Boolean);

  if (!topicSnippets.length) {
    const speakerBreakdown = buildSpeakerBreakdown(chatSegments);
    return speakerBreakdown
      ? `STT 요약은 없고, 잡담 구간은 ${speakerBreakdown}로 기록되었습니다.`
      : "STT 요약은 없지만 잡담 구간이 감지되었습니다.";
  }

  const uniqueSnippets = [...new Set(topicSnippets)].slice(0, 5);
  return truncateText(uniqueSnippets.join(" / "), 500);
}

function analyzeSegment(durationMs, samples) {
  const averageVolume = getAverageVolume(samples);
  const loudSamples = samples.filter((value) => value >= 18).length;
  const loudRatio = samples.length ? loudSamples / samples.length : 0;
  const decision = averageVolume >= 13 || loudRatio >= 0.24 ? "chat" : "study";

  return {
    averageVolume,
    loudRatio,
    decision,
    speaker: decision === "chat" ? state.activeSpeaker : "",
    durationMs
  };
}

function addModalRow(label, value) {
  const row = document.createElement("div");
  row.className = "modal-row";

  const name = document.createElement("span");
  name.textContent = label;

  const content = document.createElement("strong");
  content.textContent = value || "-";

  row.append(name, content);
  modalBodyEl.appendChild(row);
}

function openSegmentModal(segment) {
  if (!segmentModalEl || !modalBodyEl) return;

  modalBodyEl.innerHTML = "";
  modalBadgeEl.className = `badge ${segment.decision === "chat" ? "chat" : ""}`;
  modalBadgeEl.textContent = segment.decision === "study" ? "공부" : "잡담";
  modalTitleEl.textContent = segment.label;

  addModalRow("녹음 시간", `${getTimeStamp(segment.startedAt)} - ${getTimeStamp(segment.endedAt)}`);
  addModalRow("구간 길이", formatDuration(segment.durationMs));
  addModalRow("떠든 사람", segment.speaker || "발화자 없음");
  addModalRow("평균 소리", `${Math.round(segment.averageVolume)}%`);
  addModalRow("백엔드 상태", segment.uploadStatus);
  addModalRow("STT 상태", segment.sttStatus || "-");
  addModalRow("AI 판정 상태", segment.llmStatus || "-");

  if (segment.transcript) addModalRow("STT", segment.transcript);
  if (segment.llmSummary) addModalRow("AI 요약", segment.llmSummary);
  if (segment.classificationReason) addModalRow("판정 근거", segment.classificationReason);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = segment.url;
  modalBodyEl.appendChild(audio);

  const download = document.createElement("a");
  download.href = segment.url;
  download.download = `${state.roomName || "study"}-${segment.index}.webm`;
  download.textContent = "녹음 파일 다운로드";
  download.className = "modal-download";
  modalBodyEl.appendChild(download);

  segmentModalEl.classList.remove("hidden");
}

function closeSegmentModal() {
  segmentModalEl?.classList.add("hidden");
}

function renderSegments() {
  if (!decisionFeedEl) return;
  decisionFeedEl.innerHTML = "";

  const recentSegments = state.segments.slice(-8).reverse();
  if (!recentSegments.length) {
    const empty = document.createElement("p");
    empty.className = "decision-empty";
    empty.textContent = "아직 판정된 구간이 없습니다.";
    decisionFeedEl.appendChild(empty);
    return;
  }

  recentSegments.forEach((segment) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `decision-card ${segment.decision === "chat" ? "chat" : "study"}`;
    item.addEventListener("click", () => openSegmentModal(segment));

    const label = document.createElement("span");
    label.className = "decision-label";
    label.textContent = segment.decision === "study" ? "공부" : "잡담";

    const speaker = document.createElement("strong");
    speaker.textContent = segment.decision === "chat" ? segment.speaker || "발화자 없음" : "떠든 사람 없음";

    item.append(label, speaker);
    decisionFeedEl.appendChild(item);
  });
}

async function uploadSegmentRecord(segment) {
  if (!state.backendUrl) {
    segment.uploadStatus = "백엔드 미설정";
    renderSegments();
    return;
  }

  segment.uploadStatus = "백엔드 전송 중";
  renderSegments();

  const requestPayload = {
    ...buildBaseRecord("segment_recorded"),
    segment_index: segment.index,
    segment_started_at: getTimeStamp(segment.startedAt),
    segment_ended_at: getTimeStamp(segment.endedAt),
    duration_ms: segment.durationMs,
    duration_seconds: Math.round(segment.durationMs / 1000),
    frontend_decision: segment.decision,
    frontend_speaker: segment.speaker,
    average_volume: Math.round(segment.averageVolume),
    loud_ratio: Number(segment.loudRatio.toFixed(3)),
    audio_mime_type: segment.mimeType,
    audio_size_bytes: segment.blob.size
  };

  const formData = new FormData();
  formData.append("audio", segment.blob, `${state.roomName || "study"}-${segment.index}.webm`);
  formData.append("request", JSON.stringify(requestPayload));

  try {
    const response = await fetch(`${cleanBackendUrl()}/audio-segment`, {
      method: "POST",
      headers: {
        "ngrok-skip-browser-warning": "true"
      },
      body: formData
    });
    const responseText = await response.text();
    let data = {};

    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      segment.uploadStatus = `응답 JSON 아님: HTTP ${response.status}`;
      renderSegments();
      updateBoard();
      return;
    }

    segment.uploadStatus = response.ok ? data.spreadsheet_status || "백엔드 처리 완료" : `백엔드 실패 ${response.status}`;
    segment.decision = data.decision || segment.decision;
    segment.speaker = data.speaker || segment.speaker;
    segment.transcript = data.transcript || "";
    segment.sttStatus = data.stt_status || "";
    segment.classificationReason = data.classification_reason || "";
    segment.classificationMethod = data.classification_method || "";
    segment.llmStatus = data.llm_status || "";
    segment.llmSummary = data.llm_summary || "";
    segment.llmModel = data.llm_model || "";
  } catch (error) {
    segment.uploadStatus = `백엔드 전송 실패: ${error.message}`;
  }

  renderSegments();
  updateBoard();
}

function startMeter() {
  const source = state.audioContext.createMediaStreamSource(state.stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 512;
  source.connect(state.analyser);

  const data = new Uint8Array(state.analyser.fftSize);
  state.meterTimer = setInterval(() => {
    state.analyser.getByteTimeDomainData(data);
    let sum = 0;

    for (const value of data) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / data.length);
    const volume = Math.min(100, Math.round(rms * 260));
    $("#meter").style.width = `${volume}%`;
    state.volumeSamples.push(volume);
  }, 250);
}

function getMimeType() {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

function startRecorder() {
  const chunks = [];
  const samples = [];
  const segmentStartedAt = new Date();
  state.chunks = chunks;
  state.volumeSamples = samples;
  state.segmentStartedAt = segmentStartedAt;

  const options = {};
  const mimeType = getMimeType();
  if (mimeType) options.mimeType = mimeType;

  const recorder = new MediaRecorder(state.stream, options);
  state.recorder = recorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  recorder.addEventListener("stop", () => {
    if (!chunks.length || state.recorderSkipSave) return;

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - segmentStartedAt.getTime();
    const analysis = analyzeSegment(durationMs, samples);
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const url = URL.createObjectURL(blob);
    const index = state.segments.length + 1;

    const segment = {
      index,
      label: `${index}번째 구간`,
      blob,
      url,
      mimeType: recorder.mimeType || "audio/webm",
      startedAt: segmentStartedAt,
      endedAt,
      createdAt: endedAt,
      ...analysis,
      transcript: "",
      classificationMethod: "",
      classificationReason: "",
      llmStatus: "",
      llmSummary: "",
      llmModel: "",
      uploadStatus: "대기"
    };

    state.segments.push(segment);
    renderSegments();
    updateBoard();
    const uploadPromise = uploadSegmentRecord(segment);
    state.pendingUploads.push(uploadPromise);
    uploadPromise.finally(() => {
      state.pendingUploads = state.pendingUploads.filter((item) => item !== uploadPromise);
    });
  });

  recorder.start();
  $("#recordingText").textContent = `${state.segmentSeconds}초 단위로 실제 녹음 중입니다.`;
}

function stopRecorder(recorder, skipSave = false) {
  return new Promise((resolve) => {
    if (!recorder || recorder.state !== "recording") {
      resolve();
      return;
    }

    state.recorderSkipSave = skipSave;
    recorder.addEventListener("stop", () => {
      state.recorderSkipSave = false;
      resolve();
    }, { once: true });
    recorder.stop();
  });
}

async function rotateSegment() {
  if (state.isPaused || !state.recorder || state.recorder.state !== "recording") return;
  const currentRecorder = state.recorder;
  await stopRecorder(currentRecorder);
  if (!state.isPaused && state.stream) startRecorder();
}

async function startSession() {
  state.roomName = $("#roomName").value.trim() || "이름 없는 스터디룸";
  state.backendUrl = DEFAULT_BACKEND_URL;
  state.appsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
  state.sheetName = DEFAULT_SHEET_NAME;
  state.segmentSeconds = Number($("#segmentSeconds").value);
  state.activeSpeaker = state.participants[0] || "";
  state.sessionId = `SESSION-${Date.now().toString(36).toUpperCase()}`;
  state.startedAt = Date.now();
  state.segments = [];
  state.pendingUploads = [];
  state.isPaused = false;

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("이 브라우저에서는 마이크 녹음을 사용할 수 없습니다. 최신 Chrome, Edge, Safari를 사용해 주세요.");
    return;
  }

  try {
    await loadUserIp();
    await sendBackendEvent("session_started", {
      segment_seconds: state.segmentSeconds
    });

    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    startMeter();
    startRecorder();
    state.segmentTimer = setInterval(rotateSegment, state.segmentSeconds * 1000);
    state.boardTimer = setInterval(updateBoard, 500);

    $("#setupPage").classList.add("hidden");
    $("#studyPage").classList.remove("hidden");
    $("#activeRoomName").textContent = state.roomName;
    renderSpeakerButtons();
    renderSegments();
    setStatus("녹음 중", true);
  } catch (error) {
    alert(`마이크 권한을 받을 수 없습니다: ${error.message}`);
    setStatus("마이크 권한 필요");
  }
}

async function pauseOrResume() {
  if (!state.recorder) return;
  state.isPaused = !state.isPaused;

  if (state.isPaused) {
    await stopRecorder(state.recorder, true);
    $("#pauseRecording").textContent = "다시 녹음";
    $("#recordingText").textContent = "녹음이 일시정지되었습니다.";
    setStatus("일시정지");
    await sendBackendEvent("session_paused");
  } else {
    startRecorder();
    $("#pauseRecording").textContent = "일시정지";
    setStatus("녹음 중", true);
    await sendBackendEvent("session_resumed");
  }
}

async function stopMedia() {
  clearInterval(state.segmentTimer);
  clearInterval(state.meterTimer);
  clearInterval(state.boardTimer);

  await stopRecorder(state.recorder);
  state.stream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close();

  state.stream = null;
  state.audioContext = null;
  state.recorder = null;
  $("#meter").style.width = "0%";
  setStatus("종료");
}

async function finishSession() {
  const finishButton = $("#finishSession");
  if (finishButton.disabled) return;
  finishButton.disabled = true;
  finishButton.textContent = "종료 저장 중";

  await stopMedia();
  if (state.pendingUploads.length > 0) {
    setStatus("구간 분석 저장 중");
    await Promise.allSettled(state.pendingUploads);
  }

  const totalMs = Date.now() - state.startedAt;
  const studySegments = state.segments.filter((segment) => segment.decision === "study");
  const chatSegments = state.segments.filter((segment) => segment.decision === "chat");
  const studyMs = studySegments.reduce((sum, segment) => sum + segment.durationMs, 0);
  const excludedMs = Math.max(0, totalMs - studyMs);
  const speakerCounts = chatSegments.reduce((map, segment) => {
    if (segment.speaker) map[segment.speaker] = (map[segment.speaker] || 0) + 1;
    return map;
  }, {});
  const topSpeaker = Object.entries(speakerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
  const participantNames = state.participants.join(", ");
  const chatSummary = buildChatSummary(chatSegments);
  const summaryFields = {
    record_type: "session_summary",
    user_ip: state.userIp,
    user_name: participantNames,
    operation_time: formatDuration(totalMs),
    pure_study_time: formatDuration(studyMs),
    chat_duration: formatDuration(excludedMs),
    top_speaker: topSpeaker,
    chat_summary: chatSummary
  };
  const summaryResult = await insertSummaryDirectly(buildCompactSummaryRecord(summaryFields));

  setStatus(isSpreadsheetSaved(summaryResult) ? "요약 저장 완료" : `요약 저장 실패: ${summaryResult.status}`);

  $("#resultTotal").textContent = formatDuration(totalMs);
  $("#resultStudy").textContent = formatDuration(studyMs);
  $("#resultChat").textContent = formatDuration(excludedMs);
  $("#resultSegments").textContent = `${state.segments.length}개`;
  $("#resultStudySegments").textContent = `${studySegments.length}개`;
  $("#resultSpeaker").textContent = topSpeaker;

  $("#studyPage").classList.add("hidden");
  $("#resultPage").classList.remove("hidden");
}

function downloadCsv() {
  const header = ["index", "createdAt", "durationSeconds", "decision", "averageVolume", "loudRatio", "speaker", "transcript", "llmStatus", "llmSummary", "uploadStatus"];
  const rows = state.segments.map((segment) => [
    segment.index,
    segment.createdAt.toISOString(),
    Math.round(segment.durationMs / 1000),
    segment.decision,
    Math.round(segment.averageVolume),
    Number(segment.loudRatio.toFixed(3)),
    segment.speaker || "",
    segment.transcript || "",
    segment.llmStatus || "",
    segment.llmSummary || "",
    segment.uploadStatus
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.roomName || "study"}-summary.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

$("#addParticipant").addEventListener("click", () => {
  const input = $("#participantName");
  const name = input.value.trim();
  if (!name || state.participants.includes(name)) return;
  state.participants.push(name);
  input.value = "";
  renderParticipants();
});

$("#participantName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#addParticipant").click();
  }
});

$("#roomForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.participants.length === 0) {
    alert("참가자를 한 명 이상 등록해 주세요.");
    return;
  }
  startSession();
});

$("#pauseRecording").addEventListener("click", pauseOrResume);
$("#finishSession").addEventListener("click", finishSession);
$("#downloadCsv").addEventListener("click", downloadCsv);
$("#restart").addEventListener("click", () => window.location.reload());
$("#closeModal")?.addEventListener("click", closeSegmentModal);
segmentModalEl?.addEventListener("click", (event) => {
  if (event.target?.hasAttribute("data-close-modal")) closeSegmentModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSegmentModal();
});

state.userId = getUserId();
$("#userId").value = state.userId;
renderParticipants();
