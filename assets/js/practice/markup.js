const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function markupWord(word) {
  const escaped = escapeHtml(word.w);
  let inner = escaped;
  if (word.strong && word.syl) {
    const idx = escaped.toLowerCase().indexOf(word.syl.toLowerCase());
    if (idx >= 0) {
      inner =
        escaped.slice(0, idx) +
        `<span class="pr-syl">${escaped.slice(idx, idx + word.syl.length)}</span>` +
        escaped.slice(idx + word.syl.length);
    }
  }
  const classes = ["pr-word", word.strong ? "pr-strong" : "pr-weak"];
  if (word.link) classes.push("pr-link");
  return `<span class="${classes.join(" ")}">${inner}</span>`;
}

export function renderStressedSentence(sentence) {
  return sentence.words.map(markupWord).join(" ");
}

export function renderChunks(sentence) {
  return sentence.chunks
    .map(
      (c) =>
        `<span class="pr-chunk"><span class="pr-chunk-en">${escapeHtml(c.en)}</span>` +
        `<span class="pr-chunk-ko">${escapeHtml(c.ko)}</span></span>`
    )
    .join('<span class="pr-chunk-break">/</span> ');
}

/** 단계 맨 위의 목표. title·why는 코드에 박힌 고정 문구라 그대로 쓴다. */
export function goalCard(title, why) {
  return `<div class="pr-goal"><h2 class="pr-goal-title">${title}</h2><p class="pr-goal-why">${why}</p></div>`;
}

/** 가려진 원고 — 문장 길이만큼의 막대로 "여기 문장이 있다"만 보여준다. */
/** 파형 장식 — 말소리처럼 오르내리는 고정 패턴이라 매번 같은 모양이다 (녹음 카드·가리고 듣기 카드) */
export function waveBars(n = 40) {
  const bars = Array.from(
    { length: n },
    (_, i) => `<span style="--h:${Math.min(100, Math.round(30 + 65 * Math.abs(Math.sin(i * 0.55) * Math.sin(i * 0.21 + 1.2)) + 12 * Math.abs(Math.sin(i * 2.7))))}%"></span>`
  ).join("");
  return `<div class="pr-wave" aria-hidden="true">${bars}</div>`;
}

/** 시작 전 카드에 보이는 숫자들 — 이번 단계가 무엇을 요구하는지 */
export function startFacts(items) {
  return `<dl class="pr-facts">${items
    .map(([value, label]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`)
    .join("")}</dl>`;
}

/** 결과에 맞춘 격려 문구. tone: "great" | "good" | "keep" */
export function feedback(tone, text) {
  return `<p class="pr-feedback pr-feedback--${tone}">${text}</p>`;
}

export function renderDictationResult(ops) {
  return ops
    .map((op) => {
      if (op.type === "match") {
        return `<span class="pr-dict-word pr-dict-match">${escapeHtml(op.correct)}</span>`;
      }
      if (op.type === "wrong") {
        return (
          `<span class="pr-dict-word pr-dict-wrong" title="정답: ${escapeHtml(op.correct)}">` +
          `${escapeHtml(op.said)}</span>`
        );
      }
      if (op.type === "missing") {
        return `<span class="pr-dict-word pr-dict-missing">${escapeHtml(op.correct)}</span>`;
      }
      return `<span class="pr-dict-word pr-dict-extra">${escapeHtml(op.said)}</span>`;
    })
    .join(" ");
}
