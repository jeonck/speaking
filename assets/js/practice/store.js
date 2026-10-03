const PREFIX = "speaking:practice:";
const MAX_ATTEMPTS = 20;

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 실패(사생활 보호 모드 등)는 조용히 무시 — 실습 자체는 계속 동작해야 한다
  }
}

export function loadHistory(slug) {
  const raw = safeGet(PREFIX + slug);
  if (!raw) return { attempts: [] };
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.attempts) ? parsed : { attempts: [] };
  } catch {
    return { attempts: [] };
  }
}

export function todayCount(slug, today) {
  return loadHistory(slug).attempts.filter((a) => a.date === today).length;
}

export function saveAttempt(slug, attempt) {
  const history = loadHistory(slug);
  history.attempts.push(attempt);
  if (history.attempts.length > MAX_ATTEMPTS) {
    history.attempts = history.attempts.slice(-MAX_ATTEMPTS);
  }
  safeSet(PREFIX + slug, JSON.stringify(history));
  return history;
}

export function previousAttempt(slug) {
  const attempts = loadHistory(slug).attempts;
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}
