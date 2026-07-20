import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const appPath = new URL("../app.js", import.meta.url);
const checkOnly = process.argv.includes("--check");
let source = await readFile(appPath, "utf8");
let changed = false;

function replaceRequired(label, oldValue, newValue, hardenedMarker) {
  if (source.includes(oldValue)) {
    source = source.replace(oldValue, newValue);
    changed = true;
    return;
  }
  if (!source.includes(hardenedMarker)) {
    throw new Error(`${label} target was not found and the hardened marker is absent.`);
  }
}

replaceRequired(
  "record ID",
  'const makeId = (prefix) => `${prefix}-${String(Date.now()).slice(-5)}`;',
  `const makeId = (prefix) => {
  const token = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().split("-")[0].toUpperCase()
    : \`\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 8)}\`.toUpperCase();
  return \`\${prefix}-\${token}\`;
};`,
  "globalThis.crypto?.randomUUID",
);

replaceRequired(
  "inventory metric",
  'delta: "+6.2%"',
  'delta: "Live count"',
  'delta: "Live count"',
);

const oldChart = `function renderChart() {
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const stockIn = [58,92,46,110,76,128,65], stockOut = [36,55,68,52,87,73,42];
  $("#stockChart").innerHTML = days.map((day, i) => \`<div class="chart-day"><div class="bar-pair"><i class="bar in" style="height:\${stockIn[i]}px"></i><i class="bar out" style="height:\${stockOut[i]}px"></i></div><span>\${day}</span></div>\`).join("");
}`;

const newChart = `function renderChart() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return date;
  });
  const key = value => new Date(value).toLocaleDateString("en-CA");
  const movements = days.map(day => {
    const dayKey = key(day);
    const stockIn = state.invoices
      .filter(document => document.stockApplied !== false && Number(document.direction) === 1 && key(document.date) === dayKey)
      .reduce((sum, document) => sum + (document.lines || []).reduce((lineSum, line) => lineSum + (Number(line.qty) || 0), 0), 0);
    const supplierReturns = state.invoices
      .filter(document => document.stockApplied !== false && Number(document.direction) === -1 && key(document.date) === dayKey)
      .reduce((sum, document) => sum + (document.lines || []).reduce((lineSum, line) => lineSum + (Number(line.qty) || 0), 0), 0);
    const sold = state.sales
      .filter(sale => key(sale.date) === dayKey)
      .reduce((sum, sale) => sum + saleItemCounts(sale).product, 0);
    return { day, stockIn, stockOut: sold + supplierReturns };
  });
  const maximum = Math.max(1, ...movements.flatMap(item => [item.stockIn, item.stockOut]));
  $("#stockChart").innerHTML = movements.map(item => {
    const inHeight = item.stockIn ? Math.max(4, Math.round(item.stockIn / maximum * 160)) : 0;
    const outHeight = item.stockOut ? Math.max(4, Math.round(item.stockOut / maximum * 160)) : 0;
    const label = item.day.toLocaleDateString("en-GB", { weekday: "short" });
    return \`<div class="chart-day"><div class="bar-pair"><i class="bar in" title="\${item.stockIn} units in" style="height:\${inHeight}px"></i><i class="bar out" title="\${item.stockOut} units out" style="height:\${outHeight}px"></i></div><span>\${label}</span></div>\`;
  }).join("");
}`;
replaceRequired("stock chart", oldChart, newChart, "const movements = days.map");

const initTarget = `  wireEvents();
  try {`;
const conflictListener = `  wireEvents();
  window.addEventListener("vanita-cloud-conflict", () => {
    window.alert("Another staff member saved newer Vanita Stock changes. This page will reload the latest shared records; your conflicting unsynced edit will not overwrite them.");
    window.location.reload();
  }, { once: true });
  try {`;
replaceRequired("cloud conflict listener", initTarget, conflictListener, 'window.addEventListener("vanita-cloud-conflict"');

const unsafeCloudStartup = `      const sharedState = await window.VanitaCloud.loadState();
      if (sharedState?.products) state = normalizeState(sharedState);
      else window.VanitaCloud.saveState(state);`;
const safeCloudStartup = `      const sharedState = await window.VanitaCloud.loadState();
      state = normalizeState(sharedState);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));`;
replaceRequired("cloud startup", unsafeCloudStartup, safeCloudStartup, "state = normalizeState(sharedState);");

const withoutUnusedViewState = source
  .replace(/^let activeView = "dashboard";\r?\n/m, "")
  .replace(/^\s*activeView\s*=\s*[^;]+;\s*\r?\n/gm, "");
if (withoutUnusedViewState !== source) {
  source = withoutUnusedViewState;
  changed = true;
}
if (source.includes("activeView")) {
  throw new Error("Unexpected activeView reference remains after removing unused assignments.");
}

if (checkOnly) {
  if (changed) {
    throw new Error("Vanita app.js is not hardened. Run `npm run harden` and commit the result.");
  }
  console.log("Vanita source hardening is present.");
} else if (changed) {
  await writeFile(appPath, source);
  console.log("Vanita app.js hardened successfully.");
} else {
  console.log("Vanita app.js was already hardened.");
}
