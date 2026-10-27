import { avg7 } from "./cut";
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

const COLS = ["weightKg", "kcal", "proteinG", "fatG", "carbsG", "fibreG", "steps", "lifted", "sleepHours", "lateNight", "hunger", "workFocus", "ateOut", "notes"] as const;

export function exportCSV(state: AppState, sessions: Session[]) {
  const lifted = new Set(sessions.map((s) => s.date.slice(0, 10)));
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = Object.keys(state.days).sort().map((d) => {
    const log = state.days[d];
    return [d, avg7(state.days, d), ...COLS.map((k) => (k === "lifted" ? log.lifted || lifted.has(d) : log[k]))].map(cell).join(",");
  });
  download(`daily-log-${stamp()}.csv`, "text/csv", ["date,avg7Kg," + COLS.join(","), ...rows].join("\n"));
}
