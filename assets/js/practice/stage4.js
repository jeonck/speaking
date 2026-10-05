import { renderStressedSentence, renderChunks, escapeHtml, goalCard } from "./markup.js";
import { formatSeconds } from "./timer.js";
import { togglePlay } from "./playback.js";
import { clearHistory, loadHistory, localDateISO } from "./store.js";
import { reviewState, attemptScore } from "./review.js";

const LEVELS = ["", "입문", "중급", "고급"];

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
      <button class="pr-btn pr-btn--secondary pr-btn--sm" type="button" data-goto="${stageId}">지금 하기</button></div>`;
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
  // 망각 곡선 복습 일정 — 단계를 마칠 때마다 저장되므로 이번 연습까지 반영돼 있다
  const review = reviewState(loadHistory(ctx.slug).attempts, localDateISO());
  const nextReview = review
    ? `<p class="pr-review-next"><b>다음 복습 ${Number(review.due.slice(5, 7))}월 ${Number(review.due.slice(8))}일</b>` +
      `<span>${review.days > 0 ? `${review.days}일 뒤` : "오늘"} 다시 들으면 오래 기억해요${review.weak ? ". 이번엔 어려웠던 만큼 간격을 짧게 잡았어요" : ""}.</span></p>`
    : "";
  // 레벨 추천 — 이번 시도 성적(이해·문제·받아쓰기 평균)으로 한 단계 위/아래를 권한다
  const score = attemptScore(results);
  let levelRec = "";
  if (ctx.level && score != null) {
    const pct = Math.round(score * 100);
    const to = score >= 0.8 ? Math.min(ctx.level + 1, 3) : score < 0.6 ? Math.max(ctx.level - 1, 1) : ctx.level;
    const why = to > ctx.level ? "넉넉히 따라왔어요" : to < ctx.level ? "조금 버거웠어요" : score >= 0.8 ? "가장 높은 레벨도 잘 따라왔어요" : score < 0.6 ? "어렵다면 같은 레벨의 짧은 구간부터" : "지금 레벨이 잘 맞아요";
    levelRec = `<p class="pr-level-rec"><b>${LEVELS[ctx.level]} 레벨에서 ${pct}%</b>` +
      `<span>${why}. <a href="/practice/?level=${to}">${LEVELS[to]} 실습 ${to === ctx.level ? "더 하기" : "해 보기"}</a></span></p>`;
  }
  // 하루 세트 진행 막대 — 칸마다 한 세트
  const segments = Array.from(
    { length: DAILY_SETS },
    (_, i) => `<span class="pr-set-seg${i < setsDone ? " is-on" : ""}"></span>`
  ).join("");

  const cards = [
    statCard(
      "직독직해 이해",
      s1 ? `${s1.understood}<small>/${s1.total}</small>` : null,
      delta(s1 && s1.understood, p1 && p1.understood, { unit: "문장" }),
      "stage1"
    ),
    statCard(
      "스피킹 시간",
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
    ${goalCard("오늘의 정리", "강세가 표시된 전체 원고로 마지막 스피킹을 하고, 기록을 저장하세요.")}
    <div class="pr-sets">
      <p class="pr-sets-text"><b>오늘 ${attemptNumber}회째</b> 연습이에요<span>하루 ${DAILY_SETS}번 반복을 권해요.</span></p>
      <div class="pr-set-bar" role="img" aria-label="오늘 ${setsDone}/${DAILY_SETS}세트">${segments}</div>
      ${nextReview}
      ${levelRec}
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
    <div class="pr-finish">
      <p class="pr-finish-title">결과는 자동으로 저장돼요</p>
      <p class="pr-finish-why">단계를 마칠 때마다 이 브라우저에만 저장하고, 다음 연습 때 이번 결과와 비교해 보여 드려요.</p>
      <button class="pr-restart pr-btn pr-btn--primary pr-btn--lg" type="button">↺ 처음부터 다시 하기</button>
      <button class="pr-clear pr-link-btn" type="button">이 실습 기록 지우기</button>
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
  // 결과는 단계마다 이미 저장됐다 — 다시 하기는 새 시도를 여는 것뿐
  panel.querySelector(".pr-restart").addEventListener("click", () => location.reload());
  panel.querySelector(".pr-clear").addEventListener("click", () => {
    if (!confirm("이 실습의 연습 기록을 모두 지울까요? 되돌릴 수 없어요.")) return;
    clearHistory(ctx.slug);
    location.reload();
  });
}
