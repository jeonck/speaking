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

/** 단계 맨 위의 목표 카드. icon·title·why는 코드에 박힌 고정 문구라 그대로 쓴다. */
export function goalCard(icon, title, why) {
  return (
    `<div class="pr-goal"><span class="pr-goal-icon" aria-hidden="true">${icon}</span>` +
    `<div><div class="pr-goal-title">${title}</div><div class="pr-goal-why">${why}</div></div></div>`
  );
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
