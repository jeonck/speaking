import { renderStressedSentence, renderChunks, escapeHtml } from "./markup.js";

export function mountStage4(panel, ctx) {
  const { data, results, previousAttempt, attemptNumber } = ctx;

  panel.innerHTML = `
    <p>오늘 ${attemptNumber}회째 시도입니다.</p>
    <div class="pr-full-script">
      ${data.sentences
        .map(
          (s) => `
        <div class="pr-sentence-row">
          <p>${renderStressedSentence(s)}</p>
          ${renderChunks(s)}
          ${s.tip ? `<p><small>${escapeHtml(s.tip)}</small></p>` : ""}
        </div>`
        )
        .join("")}
    </div>
    <h3>어휘</h3>
    <ul>
      ${data.vocab
        .map(
          (v) =>
            `<li><strong>${escapeHtml(v.term)}</strong> — ${escapeHtml(v.ko)} <small>${escapeHtml(
              v.note || ""
            )}</small></li>`
        )
        .join("")}
    </ul>
    <h3>이번 결과</h3>
    <div class="practice-result-grid" id="pr-summary"></div>
    <button class="pr-restart" type="button">다시 하기</button>
  `;

  const summaryEl = panel.querySelector("#pr-summary");
  const rows = [];
  if (results.stage1) rows.push(["직독직해 이해", `${results.stage1.understood}/${results.stage1.total}`]);
  if (results.stage2) rows.push(["낭독 시간", results.stage2.withinTarget ? "통과" : `${results.stage2.elapsedSeconds}초`]);
  if (results.stage3) rows.push(["듣기 점수", `${results.stage3.questionScore}/${results.stage3.questionTotal}`]);
  if (results.stage3 && results.stage3.dictationAccuracy != null) {
    rows.push(["받아쓰기 일치율", `${Math.round(results.stage3.dictationAccuracy * 100)}%`]);
  }
  summaryEl.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");

  if (previousAttempt) {
    summaryEl.insertAdjacentHTML(
      "beforebegin",
      `<p>직전 시도: ${previousAttempt.date} — 이해 ${previousAttempt.stage1 ? previousAttempt.stage1.understood : "-"}/${data.sentences.length}</p>`
    );
  }

  panel.querySelector(".pr-restart").addEventListener("click", () => {
    ctx.recordAttempt();
    location.reload();
  });
}
