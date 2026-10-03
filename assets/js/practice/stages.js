import { saveAttempt, todayCount, previousAttempt as getPreviousAttempt } from "./store.js";
import { mountStage1 } from "./stage1.js";
import { mountStage2 } from "./stage2.js";
import { mountStage3 } from "./stage3.js";
import { mountStage4 } from "./stage4.js";

const STAGES = [
  { id: "stage1", label: "1 직독직해", mount: mountStage1 },
  { id: "stage2", label: "2 낭독", mount: mountStage2 },
  { id: "stage3", label: "3 가리고 듣기", mount: mountStage3 },
  { id: "stage4", label: "4 정리", mount: mountStage4 },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function initPractice(root, data, slug) {
  const ctx = { data, slug, player: null, results: {} };

  const tabs = document.createElement("div");
  tabs.className = "practice-tabs";
  const panels = document.createElement("div");
  panels.className = "practice-panels";
  root.append(tabs, panels);

  const panelEls = {};
  const tabEls = {};
  STAGES.forEach((stage, i) => {
    const tab = document.createElement("button");
    tab.className = "practice-tab";
    tab.type = "button";
    tab.textContent = stage.label;
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
  function showStage(id) {
    STAGES.forEach((s) => {
      const isActive = s.id === id;
      panelEls[s.id].dataset.active = String(isActive);
      tabEls[s.id].setAttribute("aria-selected", String(isActive));
    });
    if (!mounted.has(id)) {
      mounted.add(id);
      STAGES.find((s) => s.id === id).mount(panelEls[id], ctx);
    }
  }
  showStage(STAGES[0].id);

  ctx.recordAttempt = () => {
    try {
      saveAttempt(slug, { date: todayISO(), ...ctx.results });
    } catch {
      // 저장 실패는 조용히 무시 — 실습 흐름을 막지 않는다 (store.js 자체도 방어하지만 이중 방어)
    }
  };
  ctx.previousAttempt = getPreviousAttempt(slug);
  ctx.attemptNumber = todayCount(slug, todayISO()) + 1;

  return ctx;
}
