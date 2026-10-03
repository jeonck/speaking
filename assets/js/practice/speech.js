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

  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
    }
    onUpdate(finalText.trim());
  };
  recognition.onend = () => {
    if (!stopped) recognition.start();
  };
  recognition.start();

  return {
    stop: () => {
      stopped = true;
      recognition.stop();
      return finalText.trim();
    },
  };
}
