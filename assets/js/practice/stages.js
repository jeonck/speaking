import { saveAttempt, todayCount, previousAttempt as getPreviousAttempt, localDateISO } from "./store.js";
import { mountStage1 } from "./stage1.js";
import { mountStage2 } from "./stage2.js";
import { mountStage3 } from "./stage3.js";
import { mountStage4 } from "./stage4.js";
import { PLAYER_ID, stopPlayback } from "./playback.js";

// remount: 열 때마다 다시 그린다 (정리 화면은 그 사이 쌓인 결과를 반영해야 한다)
const STAGES = [
  { id: "stage1", label: "직독직해", mount: mountStage1 },
  { id: "stage2", label: "스피킹", mount: mountStage2 },
  { id: "stage3", label: "가리고 듣기", mount: mountStage3 },
  { id: "stage4", label: "정리", mount: mountStage4, remount: true },
];


export function initPractice(root, data, slug) {
  const ctx = { data, slug, level: Number(root.dataset.level) || 0, player: null, results: {} };

  const progress = document.createElement("div");
  progress.className = "pr-progress";
  const tabs = document.createElement("div");
  tabs.className = "practice-tabs";
  tabs.setAttribute("role", "tablist");
  const panels = document.createElement("div");
  panels.className = "practice-panels";
  // 플레이어는 단계 패널 밖에 하나만 둔다 — 패널을 다시 그려도 iframe이 지워지지 않게
  const playerHost = document.createElement("div");
  playerHost.className = "pr-hidden-player";
  playerHost.innerHTML = `<div id="${PLAYER_ID}"></div>`;
  root.append(progress, tabs, panels, playerHost);

  const panelEls = {};
  const tabEls = {};
  const done = new Set();
  STAGES.forEach((stage, i) => {
    const tab = document.createElement("button");
    tab.className = "practice-tab";
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.innerHTML = `<span class="pr-step-num">${i + 1}</span><span>${stage.label}</span>`;
    tab.dataset.stageId = stage.id;
    tab.setAttribute("aria-selected", String(i === 0));
    tab.addEventListener("click", () => showStage(stage.id));
    tabs.appendChild(tab);
    tabEls[stage.id] = tab;

    const panel = document.createElement("div");
    panel.className = "practice-panel";
    panel.dataset.active = String(i === 0);
    panels.appendChild(panel);
    panelEls[stage.id] = panel;
  });

  const mounted = new Set();
  function showStage(id, scroll = true) {
    stopPlayback();
    STAGES.forEach((s) => {
      const isActive = s.id === id;
      panelEls[s.id].dataset.active = String(isActive);
      tabEls[s.id].setAttribute("aria-selected", String(isActive));
    });
    const stage = STAGES.find((s) => s.id === id);
    if (!mounted.has(id) || stage.remount) {
      mounted.add(id);
      stage.mount(panelEls[id], ctx);
    }
    if (scroll) scrollToStages();
  }

  function scrollToStages(behavior = "smooth") {
    // 상단 메뉴가 고정(sticky)일 때만 그 높이만큼 더 내려서 단계 탭이 가리지 않게
    const header = document.querySelector(".header");
    const sticky = header && getComputedStyle(header).position === "sticky";
    const offset = (sticky ? header.offsetHeight : 0) + 16;
    window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - offset, behavior });
  }

  function renderProgress() {
    progress.innerHTML =
      `<div class="pr-progress-text"><span>오늘 <b>${ctx.attemptNumber}회째</b> 연습</span>` +
      `<span>${STAGES.length}단계 중 <b>${done.size}</b>단계 완료</span></div>` +
      // 단계마다 한 칸 — 끝낸 단계는 잉크로 채운다
      `<div class="pr-progress-bar" aria-hidden="true">${STAGES.map((s) => `<span${done.has(s.id) ? ' class="is-done"' : ""}></span>`).join("")}</div>`;
  }

  // 단계가 결과를 남기면 탭에 ✓를 달고 진행도를 올린 뒤 이번 시도를 바로 저장한다 —
  // 정리 단계까지 가지 않고 떠나도 그날의 연습 횟수와 결과가 남게
  ctx.markDone = (id) => {
    done.add(id);
    tabEls[id].classList.add("is-done");
    tabEls[id].querySelector(".pr-step-num").textContent = "✓";
    renderProgress();
    ctx.recordAttempt();
  };
  ctx.goTo = (id) => showStage(id);
  // ctx는 첫 showStage(mount) 호출 전에 완전히 갖춰져야 한다 — stage1 mount가
  // ctx.attemptNumber 등을 읽는 미래 변경이 undefined를 보지 않도록.
  // 이 페이지를 연 한 번의 연습 = 시도 하나(id). 단계를 끝낼 때마다 같은 시도를 덮어쓴다
  ctx.attemptId = Date.now();
  ctx.attemptDate = localDateISO();
  ctx.recordAttempt = () => {
    try {
      saveAttempt(slug, { id: ctx.attemptId, date: ctx.attemptDate, ...ctx.results });
    } catch {
      // 저장 실패는 조용히 무시 — 실습 흐름을 막지 않는다 (store.js 자체도 방어하지만 이중 방어)
    }
  };
  ctx.previousAttempt = getPreviousAttempt(slug, ctx.attemptId);
  ctx.attemptNumber = todayCount(slug, ctx.attemptDate) + 1;
  renderProgress();

  // 주소 끝이 #stage2 같으면 그 단계로 바로 연다 (홈의 단계 카드가 쓰는 링크)
  const fromHash = STAGES.find((s) => `#${s.id}` === location.hash);
  showStage((fromHash || STAGES[0]).id, false);
  // 페이지가 다 그려진 뒤에 내려가야 브라우저의 첫 스크롤 위치에 덮이지 않는다
  if (fromHash) {
    if (document.readyState === "complete") scrollToStages("auto");
    else window.addEventListener("load", () => scrollToStages("auto"), { once: true });
  }
  // 같은 페이지에서 주소의 #stageN만 바뀌어도 그 단계로 옮긴다
  window.addEventListener("hashchange", () => {
    const stage = STAGES.find((s) => `#${s.id}` === location.hash);
    if (stage) showStage(stage.id);
  });

  return ctx;
}
