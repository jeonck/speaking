// 사이트 전체 개인화 — 이 브라우저의 연습 기록으로 복습 일정을 보여 준다. 서버로 보내는 것은 없다.
// - 실습 카드: '복습할 때' / 'n일 뒤 복습' / '오늘 연습함'
// - 홈: 오늘 복습할 실습(지난 순) — 없으면 다가오는 복습
import { PREFIX, localDateISO } from "./practice/store.js";
import { reviewState } from "./practice/review.js";

function readAll() {
  const mine = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        const attempts = (JSON.parse(localStorage.getItem(key)) || {}).attempts || [];
        if (attempts.length) mine[key.slice(PREFIX.length)] = attempts;
      } catch {
        // 깨진 항목 하나는 건너뛴다
      }
    }
  } catch {
    // 저장소를 못 읽으면(사생활 보호 모드 등) 개인화 없이 그대로
  }
  return mine;
}

const slugOf = (href) => {
  const m = /\/practice\/([^/?#]+)\/?/.exec(href || "");
  return m && m[1];
};

const shortDate = (iso) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
};

/** 카드·목록에 붙는 한 줄 */
export function reviewLabel(s) {
  if (!s) return null;
  if (s.isDue) return { text: s.days < 0 ? `복습할 때 (${-s.days}일 지남)` : "오늘 복습할 때", due: true };
  if (s.practicedToday) return { text: `오늘 연습함, ${s.days}일 뒤 복습`, due: false };
  return { text: `${s.days}일 뒤 복습`, due: false };
}

function badge(label) {
  const el = document.createElement("span");
  el.className = "pr-badge pr-badge--mine" + (label.due ? " is-due" : "");
  el.textContent = label.text;
  return el;
}

function decorateCards(states) {
  document.querySelectorAll(".practice-card").forEach((card) => {
    const s = states[slugOf(card.getAttribute("href"))];
    const row = card.querySelector(".practice-card-badges");
    if (s && row && !row.querySelector(".pr-badge--mine")) row.appendChild(badge(reviewLabel(s)));
  });
}

function fillHome(states, mine) {
  const box = document.querySelector("[data-continue]");
  const picksEl = document.getElementById("home-today");
  if (!box || !picksEl) return;
  const bySlug = {};
  try {
    JSON.parse(picksEl.textContent).forEach((p) => { bySlug[slugOf(p.url)] = p; });
  } catch {
    return;
  }
  const items = Object.keys(states).filter((s) => bySlug[s]).map((slug) => ({ slug, s: states[slug] }));
  if (!items.length) return;
  const due = items.filter((x) => x.s.isDue).sort((a, b) => a.s.days - b.s.days);
  const upcoming = items.filter((x) => !x.s.isDue).sort((a, b) => a.s.days - b.s.days);
  const show = (due.length ? due : upcoming).slice(0, 4);

  box.querySelector("[data-continue-title]").textContent = due.length ? `오늘 복습할 실습 ${due.length}개` : "다가오는 복습";
  const list = box.querySelector("[data-continue-list]");
  show.forEach(({ slug, s }) => {
    const p = bySlug[slug];
    const a = document.createElement("a");
    a.className = "home-continue-item";
    a.href = p.url;
    const t = document.createElement("span");
    t.className = "home-continue-title";
    t.textContent = p.title;
    const meta = document.createElement("span");
    meta.className = "home-continue-meta";
    meta.append(badge(reviewLabel(s)), badge({ text: `마지막 연습 ${shortDate(s.last)}`, due: false }));
    a.append(t, meta);
    const li = document.createElement("li");
    li.appendChild(a);
    list.appendChild(li);
  });
  box.hidden = false;
  box.querySelector("[data-continue-clear]").addEventListener("click", () => {
    if (!confirm("이 브라우저에 남은 연습 기록을 모두 지울까요? 복습 일정도 함께 사라지고, 되돌릴 수 없어요.")) return;
    Object.keys(mine).forEach((s) => {
      try { localStorage.removeItem(PREFIX + s); } catch { /* 지울 수 없으면 그대로 */ }
    });
    location.reload();
  });
}

const mine = readAll();
const today = localDateISO();
const states = {};
Object.keys(mine).forEach((slug) => {
  const s = reviewState(mine[slug], today);
  if (s) states[slug] = s;
});
decorateCards(states);
fillHome(states, mine);
// 검색 결과 카드처럼 나중에 그려지는 카드도 표시한다
new MutationObserver(() => decorateCards(states)).observe(document.body, { childList: true, subtree: true });
