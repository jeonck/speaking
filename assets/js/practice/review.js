// 망각 곡선에 맞춘 복습 일정 — 잊어버리기 직전에 다시 들으면 기억이 더 오래 간다(에빙하우스).
// 실습한 날(서로 다른 날짜)이 쌓일수록 간격을 넓힌다: 1 → 2 → 4 → 7 → 15 → 30일.
// 마지막 연습이 약했으면(이해·문제·받아쓰기 중 하나라도 60% 미만) 다음 날 다시.
export const INTERVALS = [1, 2, 4, 7, 15, 30];
const WEAK = 0.6;

const toDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
const fromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

function ratiosOf(a) {
  const ratios = [];
  if (!a) return ratios;
  if (a.stage1 && a.stage1.total) ratios.push(a.stage1.understood / a.stage1.total);
  if (a.stage3 && a.stage3.questionTotal) ratios.push(a.stage3.questionScore / a.stage3.questionTotal);
  if (a.stage3 && a.stage3.dictationAccuracy != null) ratios.push(a.stage3.dictationAccuracy);
  return ratios;
}

/** 마지막 시도가 약했는지 — 결과가 있는 단계만 본다 */
export function isWeak(a) {
  return ratiosOf(a).some((r) => r < WEAK);
}

/** 시도 하나의 성적(0~1) — 이해·듣기 문제·받아쓰기 중 있는 것의 평균. 결과가 없으면 null */
export function attemptScore(a) {
  const r = ratiosOf(a);
  return r.length ? r.reduce((x, y) => x + y, 0) / r.length : null;
}

/**
 * 레벨 추천 — 최근 연습한 레벨에서의 성적으로. recent: [{ level, score }] (최신 먼저, 점수 있는 것만)
 * 그 레벨 최근 3번 평균이 80% 이상이면 한 단계 위, 60% 미만이면 한 단계 아래, 아니면 그대로.
 * 2번 이상 해 봐야 판단한다. → { level, from, avg, move: "up"|"down"|"stay" } 또는 null
 */
export function recommendLevel(recent) {
  const done = (recent || []).filter((x) => x.level >= 1 && x.level <= 3 && x.score != null);
  if (!done.length) return null;
  const from = done[0].level;
  const same = done.filter((x) => x.level === from).slice(0, 3);
  if (same.length < 2) return null;
  const avg = same.reduce((s, x) => s + x.score, 0) / same.length;
  if (avg >= 0.8 && from < 3) return { level: from + 1, from, avg, move: "up" };
  if (avg < WEAK && from > 1) return { level: from - 1, from, avg, move: "down" };
  return { level: from, from, avg, move: "stay" };
}

/**
 * 연습 기록 → 복습 상태. 기록이 없으면 null.
 * { last, due, days(오늘부터 복습일까지, 음수면 지남), isDue, practicedToday, step, weak }
 */
export function reviewState(attempts, today) {
  const dated = (attempts || []).filter((a) => a && typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date));
  if (!dated.length) return null;
  const days = [...new Set(dated.map((a) => a.date))].sort();
  const last = days[days.length - 1];
  const lastAttempt = dated.filter((a) => a.date === last).pop();
  const weak = isWeak(lastAttempt);
  const step = weak ? 0 : Math.min(days.length - 1, INTERVALS.length - 1);
  const dueDay = toDay(last) + INTERVALS[step];
  const left = dueDay - toDay(today);
  return { last, due: fromDay(dueDay), days: left, isDue: left <= 0, practicedToday: last === today, step, weak };
}
