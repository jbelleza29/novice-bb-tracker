import { avg7, dayTotals, liftDates } from "./cut";
import type { AppState, Session } from "./types";

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJSON(state: AppState, sessions: Session[]) {
  download(`tracker-${stamp()}.json`, "application/json", JSON.stringify({ state, sessions }, null, 2));
}

const FOOD = ["kcal", "proteinG", "fatG", "carbsG", "fibreG"] as const;
const DAY = ["weightKg", "steps", "lifted", "sleepHours", "lateNight", "hunger", "workFocus", "ateOut", "notes"] as const;

export function exportCSV(state: AppState, sessions: Session[]) {
  const lifted = liftDates(sessions);
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const dates = [...new Set([...Object.keys(state.days), ...Object.values(state.food).filter((f) => !f.deleted).map((f) => f.date)])].sort();
  const rows = dates.map((d) => {
    const log = state.days[d];
    const t = dayTotals(state.food, d);
    return [d, avg7(state.days, d), ...FOOD.map((k) => t?.[k]), ...DAY.map((k) => (k === "lifted" ? log?.lifted || lifted.has(d) : log?.[k]))]
      .map(cell).join(",");
  });
  download(`daily-log-${stamp()}.csv`, "text/csv", ["date,avg7Kg," + [...FOOD, ...DAY].join(","), ...rows].join("\n"));
}
