export function isSpeechRecognitionSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isRecordingSupported() {
  return typeof window !== "undefined" && !!(window.MediaRecorder && navigator.mediaDevices);
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(URL.createObjectURL(new Blob(chunks, { type: "audio/webm" })));
        };
        recorder.stop();
      }),
  };
}

/**
 * 녹음 중 침묵으로 인식이 끊겨도(onend) 자동 재시작하며 누적 transcript를
 * onUpdate로 계속 보고한다. 미지원 브라우저에서는 null을 돌려준다.
 */
export function startRecognition(onUpdate) {
  if (!isSpeechRecognitionSupported()) return null;
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Impl();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  let finalText = "";
  let stopped = false;
  let errored = false;

  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
    }
    onUpdate(finalText.trim());
  };
  recognition.onerror = (e) => {
    // 권한 거부는 onend에서 자동 재시작하면 안 되는 치명적 오류 — 재시작 루프를 막는다.
    if (e.error === "not-allowed" || e.error === "service-not-allowed") errored = true;
  };
  recognition.onend = () => {
    if (!stopped && !errored) recognition.start();
  };
  recognition.start();

  return {
    // stop()이 호출된 즉시의 finalText는 아직 마지막 구간의 result 이벤트를
    // 받기 전일 수 있다 — 실제 종료(onend)를 기다린 뒤의 값을 돌려준다.
    stop: () =>
      new Promise((resolve) => {
        stopped = true;
        recognition.addEventListener("end", () => resolve(finalText.trim()), { once: true });
        recognition.stop();
      }),
  };
}
