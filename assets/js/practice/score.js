export function normalizeWord(word) {
  let w = word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "");
  w = w.replace(/(^|[^a-z0-9'])'+|'+([^a-z0-9']|$)/g, "$1$2");
  w = w.replace(/[^a-z0-9']/g, "");
  return w;
}

export function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * 단어 단위 편집 거리(비용 1)로 정답과 입력을 정렬해 각 위치를
 * match / wrong(대체) / missing(누락) / extra(추가)로 분류한다.
 */
export function scoreDictation(correctText, inputText) {
  const correct = tokenize(correctText).map(normalizeWord).filter(Boolean);
  const input = tokenize(inputText).map(normalizeWord).filter(Boolean);
  const n = correct.length;
  const m = input.length;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (correct[i - 1] === input[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && correct[i - 1] === input[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      ops.unshift({ type: "match", correct: correct[i - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({ type: "wrong", correct: correct[i - 1], said: input[j - 1] });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.unshift({ type: "missing", correct: correct[i - 1] });
      i--;
    } else {
      ops.unshift({ type: "extra", said: input[j - 1] });
      j--;
    }
  }

  const matchCount = ops.filter((o) => o.type === "match").length;
  const accuracy = n === 0 ? 1 : matchCount / n;
  return { ops, accuracy, matchCount, total: n };
}