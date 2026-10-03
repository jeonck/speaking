import { renderChunks, escapeHtml } from "./markup.js";
import { startCountdown, formatSeconds } from "./timer.js";

export function mountStage1(panel, ctx) {
  const { data } = ctx;
  const seconds = Math.ceil(data.segment.end - data.segment.start);
  let startedAt = null;

  panel.innerHTML = `
    <p>이 구간은 ${seconds}초입니다. [시작]을 누르면 그 시간 안에 스크립트를 끝까지 읽어보세요.</p>
    <button class="pr-start" type="button">시작</button>
    <div class="practice-timer" hidden></div>
    <div class="pr-script" hidden></div>
    <button class="pr-done" type="button" hidden>다 읽었다</button>
    <div class="pr-check" hidden></div>
    <div class="practice-result-grid" hidden></div>
  `;

  const startBtn = panel.querySelector(".pr-start");
  const timerEl = panel.querySelector(".practice-timer");
  const scriptEl = panel.querySelector(".pr-script");
  const doneBtn = panel.querySelector(".pr-done");
  const checkEl = panel.querySelector(".pr-check");
  const resultEl = panel.querySelector(".practice-result-grid");

  scriptEl.innerHTML = data.sentences
    .map((s, i) => `<p class="pr-sentence-row" data-i="${i}">${renderChunks(s)}</p>`)
    .join("");

  let cancelCountdown = null;

  startBtn.addEventListener("click", () => {
    startedAt = performance.now();
    startBtn.hidden = true;
    timerEl.hidden = false;
    scriptEl.hidden = false;
    doneBtn.hidden = false;
    cancelCountdown = startCountdown(seconds, {
      onTick: (r) => {
        timerEl.textContent = formatSeconds(r);
      },
      onDone: () => finish(seconds),
    });
  });

  doneBtn.addEventListener("click", () => {
    finish((performance.now() - startedAt) / 1000);
  });

  function finish(elapsed) {
    if (cancelCountdown) cancelCountdown();
    doneBtn.hidden = true;
    scriptEl.classList.add("pr-blurred");
    checkEl.hidden = false;
    checkEl.innerHTML =
      data.sentences
        .map(
          (s, i) => `
      <div class="pr-sentence-row" data-i="${i}">
        <p>${escapeHtml(s.text)}</p>
        <div class="pr-check-group" data-i="${i}">
          <button type="button" data-v="ok">이해됨</button>
          <button type="button" data-v="stuck">막힘</button>
        </div>
      </div>`
        )
        .join("") + '<button class="pr-reveal" type="button">뜻 보기</button>';

    checkEl.querySelectorAll(".pr-check-group button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.parentElement;
        group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        group.dataset.value = btn.dataset.v;
      });
    });

    checkEl.querySelector(".pr-reveal").addEventListener("click", () => {
      scriptEl.classList.remove("pr-blurred");
      checkEl.querySelector(".pr-reveal").hidden = true;
      const understood = [...checkEl.querySelectorAll(".pr-check-group")].filter(
        (g) => g.dataset.value === "ok"
      ).length;
      ctx.results.stage1 = {
        understood,
        total: data.sentences.length,
        elapsedSeconds: Math.round(elapsed),
      };
      resultEl.hidden = false;
      resultEl.innerHTML = `
        <div class="stat"><div class="label">이해한 문장</div><div class="value">${understood}/${data.sentences.length}</div></div>
        <div class="stat"><div class="label">걸린 시간</div><div class="value">${formatSeconds(elapsed)}</div></div>
      `;
    });
  }
}
