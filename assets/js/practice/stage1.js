import { renderChunks, escapeHtml, goalCard, feedback, redactedLines } from "./markup.js";
import { startCountdown, formatSeconds } from "./timer.js";

export function mountStage1(panel, ctx) {
  const { data } = ctx;
  const seconds = Math.ceil(data.segment.end - data.segment.start);
  let startedAt = null;

  panel.innerHTML = `
    ${goalCard(`${seconds}초 안에 끝까지 읽고 이해하기`, "원어민이 말하는 속도로 이해할 수 있어야 귀로도 들립니다. 거꾸로 돌아가 읽지 말고 앞에서부터 쭉 읽어 보세요.")}
    <div class="pr-cover">
      ${redactedLines(data.sentences)}
      <button class="pr-start pr-btn pr-btn--primary pr-btn--lg" type="button">▶ 읽기 시작</button>
      <p class="pr-cover-hint">누르면 원고가 보이고 ${seconds}초 타이머가 흐르기 시작해요.</p>
    </div>
    <div class="pr-timer-row" hidden>
      <div class="pr-timebar"><div></div></div>
      <span class="practice-timer"></span>
    </div>
    <div class="pr-script" hidden></div>
    <button class="pr-done pr-btn pr-btn--primary" type="button" hidden>다 읽었어요</button>
    <div class="pr-check" hidden></div>
    <div class="pr-result" hidden></div>
  `;

  const startBtn = panel.querySelector(".pr-start");
  const coverEl = panel.querySelector(".pr-cover");
  const timerRow = panel.querySelector(".pr-timer-row");
  const timerEl = panel.querySelector(".practice-timer");
  const barEl = panel.querySelector(".pr-timebar > div");
  const scriptEl = panel.querySelector(".pr-script");
  const doneBtn = panel.querySelector(".pr-done");
  const checkEl = panel.querySelector(".pr-check");
  const resultEl = panel.querySelector(".pr-result");

  // 읽는 동안은 끊어읽기·뜻 없이 원래 문장 그대로 — 덩어리와 뜻은 [뜻 확인하기]에서 공개
  scriptEl.innerHTML = data.sentences
    .map((s, i) => `<p class="pr-sentence-row" data-i="${i}">${escapeHtml(s.text)}</p>`)
    .join("");

  let cancelCountdown = null;

  startBtn.addEventListener("click", () => {
    startedAt = performance.now();
    coverEl.hidden = true;
    timerRow.hidden = false;
    scriptEl.hidden = false;
    doneBtn.hidden = false;
    cancelCountdown = startCountdown(seconds, {
      onTick: (r) => {
        timerEl.textContent = formatSeconds(r);
        barEl.style.width = `${(r / seconds) * 100}%`;
        timerRow.classList.toggle("is-low", r <= 5);
      },
      onDone: () => finish(seconds, false),
    });
  });

  doneBtn.addEventListener("click", () => {
    finish((performance.now() - startedAt) / 1000, true);
  });

  function finish(elapsed, inTime) {
    if (cancelCountdown) cancelCountdown();
    doneBtn.hidden = true;
    timerRow.hidden = true;
    scriptEl.classList.add("pr-blurred");
    checkEl.hidden = false;
    checkEl.innerHTML = `
      <h3 class="pr-section-title">${inTime ? "다 읽었네요!" : "시간이 다 됐어요."} 문장마다 이해했는지 골라 주세요</h3>
      ${data.sentences
        .map(
          (s, i) => `
      <div class="pr-check-row" data-i="${i}">
        <p class="pr-check-text">${escapeHtml(s.text)}</p>
        <div class="pr-check-group" data-i="${i}">
          <button type="button" class="pr-chip pr-chip--ok" data-v="ok" aria-pressed="false">✓ 이해됨</button>
          <button type="button" class="pr-chip pr-chip--stuck" data-v="stuck" aria-pressed="false">✗ 막힘</button>
        </div>
      </div>`
        )
        .join("")}
      <button class="pr-reveal pr-btn pr-btn--primary" type="button">뜻 확인하기</button>`;

    checkEl.querySelectorAll(".pr-check-group button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.parentElement;
        group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        group.dataset.value = btn.dataset.v;
      });
    });

    checkEl.querySelector(".pr-reveal").addEventListener("click", () => {
      const groups = [...checkEl.querySelectorAll(".pr-check-group")];
      const understood = groups.filter((g) => g.dataset.value === "ok").length;
      const total = data.sentences.length;

      // 막혔다고 고른 문장은 강조해서, 어느 덩어리에서 막혔는지 바로 보이게 한다
      scriptEl.innerHTML = data.sentences
        .map((s, i) => {
          const stuck = groups[i].dataset.value !== "ok";
          return `<p class="pr-sentence-row${stuck ? " is-stuck" : ""}" data-i="${i}">${renderChunks(s)}</p>`;
        })
        .join("");
      scriptEl.classList.remove("pr-blurred");
      checkEl.hidden = true;

      ctx.results.stage1 = { understood, total, elapsedSeconds: Math.round(elapsed) };
      ctx.markDone("stage1");

      const rate = understood / total;
      const msg =
        rate >= 0.8 && inTime
          ? feedback("great", "👏 훌륭해요! 원어민 속도로 이해하고 있어요.")
          : rate >= 0.5
            ? feedback("good", "좋아요! 표시된 문장의 덩어리 뜻을 확인하고 한 번 더 읽어 보세요.")
            : feedback("keep", "괜찮아요. 덩어리 뜻을 보며 앞에서부터 다시 읽어 보면 훨씬 쉬워져요.");

      resultEl.hidden = false;
      resultEl.innerHTML = `
        ${msg}
        <div class="practice-result-grid">
          <div class="stat"><div class="label">이해한 문장</div><div class="value">${understood}<small>/${total}</small></div></div>
          <div class="stat"><div class="label">걸린 시간</div><div class="value">${formatSeconds(elapsed)}<small> / ${formatSeconds(seconds)}</small></div></div>
        </div>
        <div class="pr-actions">
          <button class="pr-btn pr-btn--secondary" type="button" data-act="retry">↺ 다시 읽기</button>
          <button class="pr-btn pr-btn--primary" type="button" data-act="next">다음 단계: 소리 내 읽기</button>
        </div>`;
      resultEl.querySelector('[data-act="retry"]').addEventListener("click", () => mountStage1(panel, ctx));
      resultEl.querySelector('[data-act="next"]').addEventListener("click", () => ctx.goTo("stage2"));
    });
  }
}
