import { togglePlay } from "./playback.js";
import {
  renderStressedSentence,
  renderDictationResult,
  escapeHtml,
  goalCard,
  waveBars,
  startFacts,
  feedback,
} from "./markup.js";
import { scoreDictation } from "./score.js";
import { formatSeconds } from "./timer.js";

export function mountStage3(panel, ctx) {
  const { data } = ctx;
  panel.innerHTML = `
    ${goalCard("화면 없이 듣고 이해하기", "읽고 스피킹해 본 문장이 실제로 들리는지 확인해요. 전체를 듣고 문제를 푼 뒤, 한 문장씩 받아써 봅니다.")}
    <div class="pr-listen-card">
      ${startFacts([[formatSeconds(data.segment.end - data.segment.start), "한 번 듣기"], [data.sentences.length, "가려진 문장"], [data.questions.length, "내용 문제"]])}
      ${waveBars(48)}
      <div class="pr-listen-progress" style="--dur:${(data.segment.end - data.segment.start).toFixed(1)}s" aria-hidden="true"><div></div></div>
      <p class="pr-listen-hint">스크립트는 가려져 있어요. 소리에만 집중해 보세요.</p>
      <button class="pr-listen-all pr-btn pr-btn--primary pr-btn--lg" type="button">▶ 전체 듣기</button>
      <span class="pr-play-count pr-badge">아직 듣지 않았어요</span>
    </div>
    <div class="pr-notice" data-notice="player" hidden></div>
    <h3 class="pr-section-title">① 내용 이해 문제</h3>
    <p class="pr-locked"><span class="pr-locked-step" aria-hidden="true">▶</span>위 카드에서 전체를 한 번 끝까지 들으면 문제 ${data.questions.length}개가 여기 나와요</p>
    <div class="pr-questions" hidden></div>
    <div class="pr-stage3b" hidden></div>
  `;

  let playCount = 0;
  const listenCard = panel.querySelector(".pr-listen-card");
  const playCountEl = panel.querySelector(".pr-play-count");
  const listenAllBtn = panel.querySelector(".pr-listen-all");
  const lockedEl = panel.querySelector(".pr-locked");
  const questionsEl = panel.querySelector(".pr-questions");
  const playerNotice = panel.querySelector('[data-notice="player"]');

  function showPlayerError(err) {
    playerNotice.hidden = false;
    playerNotice.textContent = `영상을 불러올 수 없습니다 (${err.message}) — 재생 관련 기능만 사용할 수 없습니다.`;
  }

  listenAllBtn.addEventListener("click", () => {
    togglePlay(ctx, listenAllBtn, {
      start: data.segment.start,
      end: data.segment.end,
      row: listenCard,
      onEnd: (completed) => {
        if (!completed) return;
        playCount += 1;
        playCountEl.textContent = `${playCount}번 들었어요`;
        listenAllBtn.innerHTML = "▶ 한 번 더 듣기";
        if (playCount === 1) showQuestions();
      },
    }).catch(showPlayerError);
  });

  function showQuestions() {
    lockedEl.hidden = true;
    questionsEl.hidden = false;
    questionsEl.innerHTML =
      data.questions
        .map(
          (q, qi) => `
      <fieldset class="pr-question" data-qi="${qi}">
        <legend><span class="pr-q-num">Q${qi + 1}</span> ${escapeHtml(q.q)}</legend>
        ${q.options
          .map(
            (opt, oi) =>
              `<label class="pr-option"><input type="radio" name="q${qi}" value="${oi}"> <span>${escapeHtml(opt)}</span></label>`
          )
          .join("")}
      </fieldset>`
        )
        .join("") + '<button class="pr-grade pr-btn pr-btn--primary" type="button">채점하기</button>';

    questionsEl.querySelector(".pr-grade").addEventListener("click", (e) => {
      e.target.disabled = true;
      let correctCount = 0;
      data.questions.forEach((q, qi) => {
        const picked = questionsEl.querySelector(`input[name="q${qi}"]:checked`);
        const qEl = questionsEl.querySelector(`.pr-question[data-qi="${qi}"]`);
        const isCorrect = picked && Number(picked.value) === q.answer;
        if (isCorrect) correctCount += 1;
        qEl.classList.add(isCorrect ? "is-correct" : "is-wrong");
        qEl.querySelectorAll("input").forEach((input) => (input.disabled = true));
        qEl.querySelectorAll(".pr-option")[q.answer].classList.add("is-answer");
        qEl.insertAdjacentHTML(
          "beforeend",
          `<p class="pr-answer-note">${isCorrect ? "✅ 정답" : `❌ 정답: ${escapeHtml(q.options[q.answer])}`} — ${escapeHtml(q.why)}</p>`
        );
      });
      const total = data.questions.length;
      ctx.results.stage3 = { questionScore: correctCount, questionTotal: total };
      ctx.markDone("stage3");

      const msg =
        correctCount === total
          ? feedback("great", `🎯 ${total}문제 모두 맞혔어요! 귀가 열리고 있어요.`)
          : correctCount / total >= 0.5
            ? feedback("good", `${total}문제 중 ${correctCount}개 정답! 틀린 문제의 근거 문장을 받아쓰기로 다시 들어 보세요.`)
            : feedback("keep", `${total}문제 중 ${correctCount}개 정답. 괜찮아요 — 받아쓰기로 한 문장씩 들으면 훨씬 잘 들려요.`);
      e.target.insertAdjacentHTML("afterend", msg);
      e.target.hidden = true;
      startDictation();
    });
  }

  function startDictation() {
    const section = panel.querySelector(".pr-stage3b");
    section.hidden = false;
    section.innerHTML = `
      <h3 class="pr-section-title">② 문장별 받아쓰기</h3>
      <p class="pr-hint">▶ 버튼으로 한 문장씩 듣고, 들린 대로 입력한 뒤 확인을 누르세요.</p>
      ${data.sentences
        .map(
          (s, i) => `
      <div class="pr-dict-row" data-i="${i}">
        <div class="pr-dict-inputs">
          <span class="pr-q-num">${i + 1}</span>
          <button class="pr-listen-one pr-btn pr-btn--play" type="button" data-i="${i}" aria-label="${i + 1}번 문장 듣기">▶</button>
          <input type="text" class="pr-dict-input" data-i="${i}" placeholder="들은 대로 입력" autocomplete="off" spellcheck="false">
          <button class="pr-check-dict pr-btn pr-btn--primary pr-btn--sm" type="button" data-i="${i}">확인</button>
        </div>
        <div class="pr-dict-result"></div>
      </div>`
        )
        .join("")}
      <div class="pr-dict-summary" hidden></div>
      <div class="pr-actions">
        <button class="pr-btn pr-btn--primary" type="button" data-act="next">다음 단계: 정리</button>
      </div>`;

    section.querySelector('[data-act="next"]').addEventListener("click", () => ctx.goTo("stage4"));

    section.querySelectorAll(".pr-listen-one").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = data.sentences[Number(btn.dataset.i)];
        togglePlay(ctx, btn, { start: s.start, end: s.end, row: btn.closest(".pr-dict-row") }).catch(
          showPlayerError
        );
      });
    });

    const accuracies = [];
    section.querySelectorAll(".pr-dict-input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") section.querySelector(`.pr-check-dict[data-i="${input.dataset.i}"]`).click();
      });
    });
    section.querySelectorAll(".pr-check-dict").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        const i = Number(btn.dataset.i);
        const s = data.sentences[i];
        const row = section.querySelector(`.pr-dict-row[data-i="${i}"]`);
        const inputEl = row.querySelector(".pr-dict-input");
        inputEl.disabled = true;
        const { ops, accuracy } = scoreDictation(s.text, inputEl.value);
        accuracies.push(accuracy);
        row.classList.add(accuracy >= 0.9 ? "is-correct" : "is-checked");

        const resultEl = row.querySelector(".pr-dict-result");
        resultEl.innerHTML = `
          <div class="pr-dict-score">${Math.round(accuracy * 100)}% 일치</div>
          <p class="pr-dict-ops">${renderDictationResult(ops)}</p>
          <p class="pr-dict-answer">${renderStressedSentence(s)}</p>
          <button type="button" class="pr-replay pr-btn pr-btn--secondary pr-btn--sm" data-i="${i}">▶ 다시 듣기</button>`;
        const replayBtn = resultEl.querySelector(".pr-replay");
        replayBtn.addEventListener("click", () => {
          togglePlay(ctx, replayBtn, { start: s.start, end: s.end, row }).catch(showPlayerError);
        });

        if (accuracies.length === data.sentences.length) {
          const avg = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
          ctx.results.stage3.dictationAccuracy = avg;
          ctx.recordAttempt(); // 받아쓰기 점수도 이번 시도에 남긴다
          const summary = section.querySelector(".pr-dict-summary");
          summary.hidden = false;
          summary.innerHTML =
            avg >= 0.9
              ? feedback("great", `✍️ 받아쓰기 평균 ${Math.round(avg * 100)}%! 거의 다 들리고 있어요.`)
              : feedback("good", `받아쓰기 평균 ${Math.round(avg * 100)}%. 빨간 단어는 강세가 약하게 지나가는 곳이에요 — 다시 듣고 따라 말해 보세요.`);
        }
      });
    });
  }
}
