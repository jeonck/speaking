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

/** 마지막 시도가 약했는지 — 결과가 있는 단계만 본다 */
export function isWeak(a) {
  if (!a) return false;
  const ratios = [];
  if (a.stage1 && a.stage1.total) ratios.push(a.stage1.understood / a.stage1.total);
  if (a.stage3 && a.stage3.questionTotal) ratios.push(a.stage3.questionScore / a.stage3.questionTotal);
  if (a.stage3 && a.stage3.dictationAccuracy != null) ratios.push(a.stage3.dictationAccuracy);
  return ratios.some((r) => r < WEAK);
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
