import { renderStressedSentence, escapeHtml, goalCard, feedback } from "./markup.js";
import { startStopwatch, formatSeconds } from "./timer.js";
import { togglePlay } from "./playback.js";
import {
  isRecordingSupported,
  startRecording,
  isSpeechRecognitionSupported,
  startRecognition,
} from "./speech.js";
import { scoreDictation } from "./score.js";

const PASS_RATIO = 1.15;

export function mountStage2(panel, ctx) {
  const { data } = ctx;
  const targetSeconds = Math.ceil(data.segment.end - data.segment.start);
  const fullText = data.sentences.map((s) => s.text).join(" ");

  panel.innerHTML = `
    ${goalCard("🗣️", `${targetSeconds}초 안에 자연스럽게 소리 내 읽기`, "내가 낼 수 있는 소리는 들립니다. 원음을 먼저 듣고, 강세·연음을 확인한 다음 녹음해 보세요.")}
    <div class="pr-notice" data-notice="player" hidden></div>
    <div class="pr-toolbar">
      <button class="pr-play-all pr-btn pr-btn--secondary" type="button">▶ 원음 전체 듣기</button>
      <button class="pr-show-stress pr-btn pr-btn--secondary" type="button">강세·연음 보기</button>
    </div>
    <div class="pr-script">
      ${data.sentences
        .map(
          (s, i) =>
            `<div class="pr-sentence-row pr-play-row" data-i="${i}">
               <button type="button" class="pr-play-original pr-btn pr-btn--play" data-i="${i}" aria-label="${i + 1}번 문장 원음 듣기">▶</button>
               <div class="pr-play-text">
                 <span class="pr-line">${escapeHtml(s.text)}</span>${
                   s.tip ? `<small class="pr-tip" hidden>${escapeHtml(s.tip)}</small>` : ""
                 }
               </div>
             </div>`
        )
        .join("")}
    </div>
    <div class="pr-record-card">
      <div class="pr-record-head">
        <span>목표 시간 <b>${formatSeconds(targetSeconds)}</b></span>
        <span class="practice-timer">0:00</span>
      </div>
      <div class="pr-timebar pr-timebar--fill"><div></div></div>
      <div class="pr-notice" data-notice="mic" hidden></div>
      <button class="pr-record pr-btn pr-btn--record pr-btn--lg" type="button">● 녹음 시작</button>
    </div>
    <div class="pr-result" hidden></div>
  `;

  const recordBtn = panel.querySelector(".pr-record");
  const recordCard = panel.querySelector(".pr-record-card");
  const timerEl = panel.querySelector(".practice-timer");
  const barEl = panel.querySelector(".pr-timebar > div");
  const resultEl = panel.querySelector(".pr-result");
  const playerNotice = panel.querySelector('[data-notice="player"]');
  const micNotice = panel.querySelector('[data-notice="mic"]');

  function showPlayerError(err) {
    playerNotice.hidden = false;
    playerNotice.textContent = `원음을 불러올 수 없습니다 (${err.message}) — 녹음·타이머는 계속 사용할 수 있습니다.`;
  }

  // 처음엔 원래 문장 그대로 읽어 보게 하고, 강세·연음 표시는 버튼을 눌러야 공개
  const stressBtn = panel.querySelector(".pr-show-stress");
  stressBtn.addEventListener("click", () => {
    panel.querySelectorAll(".pr-play-row").forEach((row) => {
      const s = data.sentences[Number(row.dataset.i)];
      row.querySelector(".pr-line").innerHTML = renderStressedSentence(s);
      const tip = row.querySelector(".pr-tip");
      if (tip) tip.hidden = false;
    });
    stressBtn.hidden = true;
  });

  // 재생이 안 돼도 녹음·타이머는 그대로 쓸 수 있어야 한다 (spec §7)
  panel.querySelectorAll(".pr-play-original").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = data.sentences[Number(btn.dataset.i)];
      const row = btn.closest(".pr-play-row");
      togglePlay(ctx, btn, { start: s.start, end: s.end, row }).catch(showPlayerError);
    });
  });
  const playAllBtn = panel.querySelector(".pr-play-all");
  playAllBtn.addEventListener("click", () => {
    togglePlay(ctx, playAllBtn, { start: data.segment.start, end: data.segment.end }).catch(
      showPlayerError
    );
  });

  if (!isRecordingSupported()) {
    recordBtn.disabled = true;
    micNotice.hidden = false;
    micNotice.textContent = "이 브라우저는 녹음을 지원하지 않습니다 — 목표 시간만 참고하세요.";
    return;
  }

  recordBtn.addEventListener("click", onRecordClick);

  async function onRecordClick() {
    recordBtn.disabled = true;

    // 마이크 권한 거부 등 getUserMedia 실패는 여기서만 잡는다 — 녹음이 안 되더라도
    // 타이머는 계속 동작해야 한다 (spec §7 "마이크 거부 → 타이머 전용 모드, 사유 안내").
    let recording = null;
    let recognition = null;
    // 권한 요청 창이 떠 있는 동안 막혀 있지 않도록, 기다리는 중임을 알리고 마이크 없이
    // 진행할 수 있는 탈출구를 준다
    micNotice.hidden = false;
    micNotice.innerHTML =
      '브라우저의 마이크 권한 요청을 허용해 주세요… <button type="button" class="pr-link-btn" data-act="skip-mic">마이크 없이 타이머만 쓰기</button>';
    const skipped = new Promise((resolve) => {
      micNotice.querySelector('[data-act="skip-mic"]').addEventListener("click", () => resolve(null));
    });
    const pending = startRecording();
    try {
      recording = await Promise.race([pending, skipped]);
      if (recording) {
        micNotice.hidden = true;
        recognition = isSpeechRecognitionSupported() ? startRecognition(() => {}) : null;
      } else {
        micNotice.textContent = "마이크 없이 진행합니다 — 타이머만 동작합니다.";
        // 나중에 권한이 허용돼도 마이크를 켜 둔 채 남기지 않는다
        pending.then((r) => r.stop()).catch(() => {});
      }
    } catch (err) {
      micNotice.textContent = `마이크를 사용할 수 없습니다 (${err.message}) — 타이머만 동작합니다.`;
    }
    recordCard.classList.add("is-recording");
    const stopwatch = startStopwatch((t) => {
      timerEl.textContent = formatSeconds(t);
      barEl.style.width = `${Math.min(100, (t / targetSeconds) * 100)}%`;
      recordCard.classList.toggle("is-over", t > targetSeconds * PASS_RATIO);
    });

    recordBtn.innerHTML = "■ 녹음 끝내기";
    recordBtn.disabled = false;
    recordBtn.removeEventListener("click", onRecordClick);
    recordBtn.addEventListener("click", onStopClick);

    async function onStopClick() {
      recordBtn.removeEventListener("click", onStopClick);
      recordBtn.disabled = true;
      recordCard.classList.remove("is-recording");
      const elapsed = stopwatch.stop();
      const finalText = recognition ? await recognition.stop() : "";
      const url = recording ? await recording.stop() : null;

      const ratio = elapsed / targetSeconds;
      const pass = ratio <= PASS_RATIO;
      const accuracy = finalText ? scoreDictation(fullText, finalText).accuracy : null;
      ctx.results.stage2 = {
        elapsedSeconds: Math.round(elapsed),
        targetSeconds,
        withinTarget: pass,
        recognitionAccuracy: accuracy,
      };
      ctx.markDone("stage2");

      const msg = pass
        ? feedback("great", "🎉 목표 시간 안에 읽었어요! 원음과 내 녹음을 번갈아 들어 보세요.")
        : ratio <= 1.5
          ? feedback("good", "조금만 더! 굵은 강세 단어에 힘을 주고, 나머지는 가볍고 빠르게 읽어 보세요.")
          : feedback("keep", "괜찮아요. 원음을 한 문장씩 따라 읽은 다음 다시 도전해 보세요.");

      recordBtn.hidden = true;
      resultEl.hidden = false;
      resultEl.innerHTML = `
        ${msg}
        <div class="practice-result-grid">
          <div class="stat"><div class="label">내 시간</div><div class="value">${formatSeconds(elapsed)}<small> / ${formatSeconds(targetSeconds)}</small></div></div>
          <div class="stat ${pass ? "is-pass" : ""}"><div class="label">목표 대비</div><div class="value">${pass ? "통과" : `${Math.round(ratio * 100)}%`}</div></div>
          ${
            accuracy !== null
              ? `<div class="stat"><div class="label">발음 인식률</div><div class="value">${Math.round(accuracy * 100)}%</div></div>`
              : ""
          }
        </div>
        ${
          url
            ? `<div class="pr-compare">
                 <div class="pr-compare-label">🎙️ 내 녹음</div>
                 <audio class="pr-playback" controls src="${url}"></audio>
                 <button class="pr-btn pr-btn--secondary" type="button" data-act="original">▶ 원음 전체 듣기</button>
               </div>`
            : ""
        }
        <div class="pr-actions">
          <button class="pr-btn pr-btn--secondary" type="button" data-act="retry">↺ 다시 녹음</button>
          <button class="pr-btn pr-btn--primary" type="button" data-act="next">다음: 가리고 듣기 →</button>
        </div>`;
      const originalBtn = resultEl.querySelector('[data-act="original"]');
      if (originalBtn) {
        originalBtn.addEventListener("click", () => {
          togglePlay(ctx, originalBtn, { start: data.segment.start, end: data.segment.end }).catch(
            showPlayerError
          );
        });
      }
      resultEl.querySelector('[data-act="retry"]').addEventListener("click", () => mountStage2(panel, ctx));
      resultEl.querySelector('[data-act="next"]').addEventListener("click", () => ctx.goTo("stage3"));
    }
  }
}
