import { ensurePlayer, playRange } from "./player.js";
import { renderStressedSentence, renderDictationResult } from "./markup.js";
import { scoreDictation } from "./score.js";

export function mountStage3(panel, ctx) {
  const { data } = ctx;
  panel.innerHTML = `
    <div class="practice-player-wrap">
      <div id="pr-yt-stage3"></div>
      <div class="practice-cover">듣기에 집중하세요 (화면 가림)</div>
    </div>
    <div class="pr-player-notice" hidden></div>
    <div class="pr-stage3a">
      <button class="pr-listen-all" type="button">전체 듣기</button>
      <span class="pr-play-count">0회 재생</span>
      <div class="pr-questions" hidden></div>
    </div>
    <div class="pr-stage3b" hidden></div>
  `;

  let playCount = 0;
  const playCountEl = panel.querySelector(".pr-play-count");
  const listenAllBtn = panel.querySelector(".pr-listen-all");
  const questionsEl = panel.querySelector(".pr-questions");
  const playerNotice = panel.querySelector(".pr-player-notice");

  // 플레이어 로드/재생 오류를 사용자에게 보여주고, 재생 버튼만 계속 비활성화한다
  // (spec §7 "재생 의존 기능만 비활성, 나머지는 동작"). 실패해도 예외가 새지 않는다.
  async function safeEnsurePlayer(elementId) {
    try {
      return await ensurePlayer(ctx, elementId);
    } catch (err) {
      playerNotice.hidden = false;
      playerNotice.textContent = `영상을 불러올 수 없습니다 (${err.message}) — 재생 관련 기능만 사용할 수 없습니다.`;
      return null;
    }
  }

  listenAllBtn.addEventListener("click", async () => {
    listenAllBtn.disabled = true;
    const player = await safeEnsurePlayer("pr-yt-stage3");
    if (!player) {
      listenAllBtn.disabled = true;
      listenAllBtn.textContent = "재생 불가";
      return;
    }
    playRange(player, data.segment.start, data.segment.end, () => {
      listenAllBtn.disabled = false;
      playCount += 1;
      playCountEl.textContent = `${playCount}회 재생`;
      if (playCount === 1) showQuestions();
    });
  });

  function showQuestions() {
    questionsEl.hidden = false;
    questionsEl.innerHTML =
      data.questions
        .map(
          (q, qi) => `
      <div class="pr-question" data-qi="${qi}">
        <p>${q.q}</p>
        ${q.options
          .map((opt, oi) => `<label><input type="radio" name="q${qi}" value="${oi}"> ${opt}</label><br>`)
          .join("")}
      </div>`
        )
        .join("") + '<button class="pr-grade" type="button">채점</button>';

    questionsEl.querySelector(".pr-grade").addEventListener("click", () => {
      let correctCount = 0;
      data.questions.forEach((q, qi) => {
        const picked = questionsEl.querySelector(`input[name="q${qi}"]:checked`);
        const qEl = questionsEl.querySelector(`.pr-question[data-qi="${qi}"]`);
        const isCorrect = picked && Number(picked.value) === q.answer;
        if (isCorrect) correctCount += 1;
        qEl.insertAdjacentHTML(
          "beforeend",
          `<p class="pr-answer-note">${isCorrect ? "✅" : "❌"} ${q.options[q.answer]} — ${q.why}</p>`
        );
      });
      ctx.results.stage3 = { questionScore: correctCount, questionTotal: data.questions.length };
      startDictation();
    });
  }

  function startDictation() {
    const section = panel.querySelector(".pr-stage3b");
    section.hidden = false;
    section.innerHTML = data.sentences
      .map(
        (s, i) => `
      <div class="pr-sentence-row" data-i="${i}">
        <button class="pr-listen-one" type="button" data-i="${i}">듣기</button>
        <input type="text" class="pr-dict-input" data-i="${i}" placeholder="들은 대로 입력">
        <button class="pr-check-dict" type="button" data-i="${i}">확인</button>
        <div class="pr-dict-result"></div>
      </div>`
      )
      .join("");

    section.querySelectorAll(".pr-listen-one").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const s = data.sentences[Number(btn.dataset.i)];
        const player = await safeEnsurePlayer("pr-yt-stage3");
        if (player) playRange(player, s.start, s.end);
      });
    });

    const accuracies = [];
    section.querySelectorAll(".pr-check-dict").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const s = data.sentences[i];
        const row = section.querySelector(`.pr-sentence-row[data-i="${i}"]`);
        const input = row.querySelector(".pr-dict-input").value;
        const { ops, accuracy } = scoreDictation(s.text, input);
        accuracies.push(accuracy);

        const resultEl = row.querySelector(".pr-dict-result");
        resultEl.innerHTML = `
          <p>${renderDictationResult(ops)}</p>
          <p>${renderStressedSentence(s)}</p>
          <button type="button" class="pr-replay" data-i="${i}">다시 듣기</button>
        `;
        resultEl.querySelector(".pr-replay").addEventListener("click", async () => {
          const player = await safeEnsurePlayer("pr-yt-stage3");
          if (player) playRange(player, s.start, s.end);
        });

        if (accuracies.length === data.sentences.length) {
          const avg = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
          ctx.results.stage3.dictationAccuracy = avg;
        }
      });
    });
  }
}
