import { renderStressedSentence, escapeHtml } from "./markup.js";
import { startStopwatch, formatSeconds } from "./timer.js";
import { ensurePlayer, playRange } from "./player.js";
import {
  isRecordingSupported,
  startRecording,
  isSpeechRecognitionSupported,
  startRecognition,
} from "./speech.js";
import { scoreDictation } from "./score.js";

export function mountStage2(panel, ctx) {
  const { data } = ctx;
  const targetSeconds = Math.ceil(data.segment.end - data.segment.start);
  const fullText = data.sentences.map((s) => s.text).join(" ");

  panel.innerHTML = `
    <div id="pr-yt-stage2" class="pr-hidden-player"></div>
    <div class="pr-player-notice" hidden></div>
    <div class="pr-mic-notice" hidden></div>
    <div class="pr-script">
      ${data.sentences
        .map(
          (s, i) =>
            `<p class="pr-sentence-row" data-i="${i}">
               <button type="button" class="pr-play-original" data-i="${i}">원음</button>
               ${renderStressedSentence(s)}${s.tip ? `<br><small>${escapeHtml(s.tip)}</small>` : ""}
             </p>`
        )
        .join("")}
    </div>
    <p>목표 시간: ${formatSeconds(targetSeconds)}</p>
    <button class="pr-record" type="button">녹음 시작</button>
    <div class="practice-timer" hidden></div>
    <div class="practice-result-grid" hidden></div>
    <audio class="pr-playback" controls hidden></audio>
  `;

  const recordBtn = panel.querySelector(".pr-record");
  const timerEl = panel.querySelector(".practice-timer");
  const resultEl = panel.querySelector(".practice-result-grid");
  const audioEl = panel.querySelector(".pr-playback");
  const playerNotice = panel.querySelector(".pr-player-notice");
  const micNotice = panel.querySelector(".pr-mic-notice");

  // 원음 버튼: 플레이어 로드/재생 오류가 나도 녹음·타이머 기능은 그대로 쓸 수 있어야 한다
  // (spec §7 "YouTube API 로드 실패 → 재생 의존 기능만 비활성, 나머지는 동작").
  panel.querySelectorAll(".pr-play-original").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const s = data.sentences[Number(btn.dataset.i)];
      btn.disabled = true;
      try {
        const player = await ensurePlayer(ctx, "pr-yt-stage2");
        playRange(player, s.start, s.end, () => {
          btn.disabled = false;
        });
      } catch (err) {
        btn.disabled = true;
        btn.textContent = "원음 재생 불가";
        playerNotice.hidden = false;
        playerNotice.textContent = `원음을 불러올 수 없습니다 (${err.message}) — 녹음·타이머는 계속 사용할 수 있습니다.`;
      }
    });
  });

  if (!isRecordingSupported()) {
    recordBtn.disabled = true;
    recordBtn.insertAdjacentHTML(
      "afterend",
      "<p>이 브라우저는 녹음을 지원하지 않습니다 — 목표 시간만 참고하세요.</p>"
    );
    return;
  }

  recordBtn.addEventListener("click", onRecordClick);

  async function onRecordClick() {
    recordBtn.disabled = true;
    timerEl.hidden = false;

    // 마이크 권한 거부 등 getUserMedia 실패는 여기서만 잡는다 — 녹음이 안 되더라도
    // 타이머는 계속 동작해야 한다 (spec §7 "마이크 거부 → 타이머 전용 모드, 사유 안내").
    let recognizedText = "";
    let recording = null;
    let recognition = null;
    try {
      recording = await startRecording();
      recognition = isSpeechRecognitionSupported()
        ? startRecognition((t) => {
            recognizedText = t;
          })
        : null;
    } catch (err) {
      micNotice.hidden = false;
      micNotice.textContent = `마이크를 사용할 수 없습니다 (${err.message}) — 타이머만 동작합니다.`;
    }
    const stopwatch = startStopwatch((t) => {
      timerEl.textContent = formatSeconds(t);
    });

    recordBtn.textContent = "끝";
    recordBtn.disabled = false;
    recordBtn.removeEventListener("click", onRecordClick);
    recordBtn.addEventListener("click", onStopClick);

    async function onStopClick() {
      recordBtn.disabled = true;
      const elapsed = stopwatch.stop();
      const finalText = recognition ? await recognition.stop() : "";
      if (recording) {
        const url = await recording.stop();
        audioEl.src = url;
        audioEl.hidden = false;
      }

      const ratio = elapsed / targetSeconds;
      const accuracy = finalText ? scoreDictation(fullText, finalText).accuracy : null;
      ctx.results.stage2 = {
        elapsedSeconds: Math.round(elapsed),
        targetSeconds,
        withinTarget: ratio <= 1.15,
        recognitionAccuracy: accuracy,
      };
      resultEl.hidden = false;
      resultEl.innerHTML = `
        <div class="stat"><div class="label">내 시간</div><div class="value">${formatSeconds(elapsed)}</div></div>
        <div class="stat"><div class="label">목표 대비</div><div class="value">${
          ratio <= 1.15 ? "통과" : `${Math.round(ratio * 100)}%`
        }</div></div>
        ${
          accuracy !== null
            ? `<div class="stat"><div class="label">인식률</div><div class="value">${Math.round(
                accuracy * 100
              )}%</div></div>`
            : ""
        }
      `;
      recordBtn.removeEventListener("click", onStopClick);
      recordBtn.textContent = "다시 녹음 (새로고침)";
      recordBtn.disabled = false;
      recordBtn.onclick = () => location.reload();
    }
  }
}
