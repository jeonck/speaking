import { initPractice } from "./stages.js";

const dataEl = document.getElementById("practice-data");
const root = document.getElementById("practice-root");

if (dataEl && root) {
  const data = JSON.parse(dataEl.textContent);
  const slug = location.pathname.replace(/\/$/, "").split("/").pop();
  initPractice(root, data, slug);
} else {
  console.warn("practice: #practice-data or #practice-root missing — page has no practice content");
}
