import { renderStressedSentence, renderChunks, escapeHtml, goalCard } from "./markup.js";
import { formatSeconds } from "./timer.js";
import { togglePlay } from "./playback.js";

const DAILY_SETS = 3; // 영상에서 권한 "하루 세 번"

/** 직전 시도 대비 변화. better=true면 값이 클수록 좋다. */
function delta(now, prev, { better = true, unit = "" } = {}) {
  if (prev == null || now == null) return "";
  const diff = now - prev;
  if (Math.abs(diff) < 1e-9) return `<span class="pr-delta">직전과 같음</span>`;
  const good = better ? diff > 0 : diff < 0;
  const sign = diff > 0 ? "▲" : "▼";
  return `<span class="pr-delta ${good ? "is-up" : "is-down"}">${sign} ${Math.abs(Math.round(diff))}${unit}</span>`;
}

function statCard(label, value, deltaHtml, stageId) {
  if (value == null) {
    return `<div class="stat is-empty"><div class="label">${label}</div><div class="value">—</div>
      <button class="pr-link-btn" type="button" data-goto="${stageId}">지금 하기</button></div>`;
  }
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${deltaHtml}</div>`;
}

export function mountStage4(panel, ctx) {
  const { data, results, previousAttempt: prev, attemptNumber } = ctx;
  const s1 = results.stage1;
  const s2 = results.stage2;
  const s3 = results.stage3;
  const p1 = prev && prev.stage1;
  const p2 = prev && prev.stage2;
  const p3 = prev && prev.stage3;

  const setsDone = Math.min(attemptNumber, DAILY_SETS);
  const dots = Array.from(
    { length: DAILY_SETS },
    (_, i) => `<span class="pr-set-dot${i < setsDone ? " is-on" : ""}"></span>`
  ).join("");

  const cards = [
    statCard(
      "직독직해 이해",
      s1 ? `${s1.understood}<small>/${s1.total}</small>` : null,
      delta(s1 && s1.understood, p1 && p1.understood, { unit: "문장" }),
      "stage1"
    ),
    statCard(
      "낭독 시간",
      s2 ? `${formatSeconds(s2.elapsedSeconds)}${s2.withinTarget ? " ✓" : ""}` : null,
      delta(s2 && s2.elapsedSeconds, p2 && p2.elapsedSeconds, { better: false, unit: "초" }),
      "stage2"
    ),
    statCard(
      "듣기 문제",
      s3 ? `${s3.questionScore}<small>/${s3.questionTotal}</small>` : null,
      delta(s3 && s3.questionScore, p3 && p3.questionScore, { unit: "문제" }),
      "stage3"
    ),
    statCard(
      "받아쓰기",
      s3 && s3.dictationAccuracy != null ? `${Math.round(s3.dictationAccuracy * 100)}%` : null,
      delta(
        s3 && s3.dictationAccuracy != null ? s3.dictationAccuracy * 100 : null,
        p3 && p3.dictationAccuracy != null ? p3.dictationAccuracy * 100 : null,
        { unit: "%p" }
      ),
      "stage3"
    ),
  ].join("");

  panel.innerHTML = `
    ${goalCard("오늘의 정리", "강세가 표시된 전체 스크립트를 마지막으로 소리 내 읽고, 기록을 저장하세요.")}
    <div class="pr-sets">
      <div><b>오늘 ${attemptNumber}회째</b> 연습이에요. 하루 ${DAILY_SETS}번 반복을 권해요.</div>
      <div class="pr-set-dots">${dots}</div>
    </div>
    <h3 class="pr-section-title">이번 결과${prev ? ` <small>(직전 ${escapeHtml(String(prev.date))} 대비)</small>` : ""}</h3>
    <div class="practice-result-grid">${cards}</div>
    <h3 class="pr-section-title">전체 스크립트</h3>
    <div class="pr-full-script">
      ${data.sentences
        .map(
          (s, i) => `
        <div class="pr-sentence-row pr-play-row" data-i="${i}">
          <button type="button" class="pr-play-original pr-btn pr-btn--play" data-i="${i}" aria-label="${i + 1}번 문장 듣기">▶</button>
          <div class="pr-play-text">
            <p class="pr-line">${renderStressedSentence(s)}</p>
            <div class="pr-chunks">${renderChunks(s)}</div>
            ${s.tip ? `<small class="pr-tip">${escapeHtml(s.tip)}</small>` : ""}
          </div>
        </div>`
        )
        .join("")}
    </div>
    <h3 class="pr-section-title">어휘·표현</h3>
    <div class="pr-vocab">
      ${data.vocab
        .map(
          (v) => `<div class="pr-vocab-card"><div class="pr-vocab-term">${escapeHtml(v.term)}</div>
            <div class="pr-vocab-ko">${escapeHtml(v.ko)}</div>
            ${v.note ? `<div class="pr-vocab-note">${escapeHtml(v.note)}</div>` : ""}</div>`
        )
        .join("")}
    </div>
    <div class="pr-actions pr-actions--center">
      <button class="pr-restart pr-btn pr-btn--primary pr-btn--lg" type="button">✓ 기록 저장하고 다시 하기</button>
    </div>
  `;

  panel.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => ctx.goTo(btn.dataset.goto));
  });
  panel.querySelectorAll(".pr-play-original").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = data.sentences[Number(btn.dataset.i)];
      togglePlay(ctx, btn, { start: s.start, end: s.end, row: btn.closest(".pr-play-row") }).catch(() => {
        btn.disabled = true;
      });
    });
  });
  panel.querySelector(".pr-restart").addEventListener("click", () => {
    ctx.recordAttempt();
    location.reload();
  });
}
