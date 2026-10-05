// 연습 기록은 이 브라우저에만 남는다(localStorage) — 서버로 보내지 않는다.
// 실습마다 키 하나: speaking:practice:<실습 주소 끝> → { attempts: [{ id, date, stage1?, stage2?, stage3? }] }
// 홈·목록의 개인화(연습 횟수, 이어서 하기)도 같은 키를 읽는다 — layouts/_partials/personal.html
export const PREFIX = "speaking:practice:";
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

/** 이 기기 시간대의 오늘 날짜(YYYY-MM-DD). toISOString은 UTC라 한국에선 오전 9시 전에 어제가 된다. */
export function localDateISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** 시도 하나를 저장한다. 같은 id가 있으면 덮어쓴다 — 단계를 끝낼 때마다 같은 시도를 갱신하기 위해. */
export function saveAttempt(slug, attempt) {
  const history = loadHistory(slug);
  const i = attempt.id != null ? history.attempts.findIndex((a) => a.id === attempt.id) : -1;
  if (i >= 0) history.attempts[i] = attempt;
  else history.attempts.push(attempt);
  if (history.attempts.length > MAX_ATTEMPTS) {
    history.attempts = history.attempts.slice(-MAX_ATTEMPTS);
  }
  safeSet(PREFIX + slug, JSON.stringify(history));
  return history;
}

/** 직전 시도. exceptId를 주면 그 시도(지금 진행 중인 것)는 빼고 찾는다. */
export function previousAttempt(slug, exceptId) {
  const attempts = loadHistory(slug).attempts.filter((a) => a.id == null || a.id !== exceptId);
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

export function clearHistory(slug) {
  try {
    localStorage.removeItem(PREFIX + slug);
  } catch {
    // 지울 수 없으면 할 일이 없다
  }
}
