import { addDays, avg7, dayChecks, dayTotals, foodOn, liftDates, parseISO, type DayChecks, type Totals } from "./cut";
import type { AppState, CutSettings, FoodEntry, ISODate, Session } from "./types";

const hhmm = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const n = (x: number) => Math.round(x).toLocaleString();

export interface DayRecap {
  totals: Totals | null;
  checks: DayChecks;
  lines: string[];
}

// Plain-numbers recap of one day; no AI involved.
export function dayRecap(state: AppState, sessions: Session[], date: ISODate): DayRecap {
  const cut = state.cut!, t = cut.targets;
  const log = state.days[date];
  const food = foodOn(state.food, date);
  const totals = dayTotals(state.food, date);
  const lifted = liftDates(sessions).has(date);
  const checks = dayChecks(t, totals, log, lifted);
  const lines: string[] = [];

  if (totals) {
    const diff = totals.kcal - t.kcal;
    lines.push(`${n(totals.kcal)} of ${n(t.kcal)} kcal, ${Math.abs(diff) <= 100 ? "on target" : diff > 0 ? `${n(diff)} over` : `${n(-diff)} under`}.`);
    lines.push(totals.proteinG >= t.proteinG ? `Protein target met at ${totals.proteinG} g.` : `Protein ${totals.proteinG} of ${t.proteinG} g, ${t.proteinG - totals.proteinG} g short.`);
    lines.push(food.length === 1 ? `One entry, at ${clock(food[0].at)}.` : `Ate between ${clock(food[0].at)} and ${clock(food[food.length - 1].at)}.`);
    const big = food.reduce((a, b) => (b.kcal > a.kcal ? b : a));
    if (food.length > 1) lines.push(`Biggest: ${big.name}, ${n(big.kcal)} kcal (${Math.round((big.kcal / Math.max(1, totals.kcal)) * 100)}% of the day).`);
    const partial = (k: "fatG" | "fibreG") => food.some((f) => f[k] == null);
    if (food.some((f) => f.fatG != null)) lines.push(`Fat ${partial("fatG") ? "at least " : ""}${totals.fatG} of ${t.fatG} g.`);
    if (food.some((f) => f.fibreG != null)) lines.push(`Fibre ${partial("fibreG") ? "at least " : ""}${totals.fibreG} of ${t.fibreG} g.`);
  } else {
    lines.push("No food logged.");
  }
  if (log?.steps != null) {
    lines.push(log.steps >= t.stepsGoal ? `${n(log.steps)} steps, goal met.`
      : log.steps >= t.stepsFloor ? `${n(log.steps)} steps: floor met, ${n(t.stepsGoal - log.steps)} short of the goal.`
      : `${n(log.steps)} steps, ${n(t.stepsFloor - log.steps)} short of the floor.`);
  }
  if (log?.weightKg != null) {
    const a = avg7(state.days, date);
    lines.push(a == null ? `${log.weightKg} kg. The 7-day average needs 4 weigh-ins.` : `${log.weightKg} kg, 7-day average ${a} kg.`);
  }
  lines.push(checks.lifted ? "Lifted." : "No lifting logged.");
  return { totals, checks, lines };
}

const cutName = (s: string) => (s.length > 60 ? s.slice(0, 57) + "…" : s);

// Fat, carbs and fibre are optional per entry; a plain sum would report missing values as 0.
function totalsForAI(food: FoodEntry[], totals: Totals | null) {
  if (!totals) return null;
  const part = (k: "fatG" | "carbsG" | "fibreG") => {
    const missing = food.filter((f) => f[k] == null).length;
    return missing === 0 ? totals[k] : missing === food.length ? null : `at least ${totals[k]} (missing on ${missing} of ${food.length} entries)`;
  };
  return { kcal: totals.kcal, protein: totals.proteinG, fat: part("fatG"), carbs: part("carbsG"), fibre: part("fibreG") };
}

// What the daily insight sees. Short keys and 24-hour times keep it to a few hundred tokens.
export function daySummary(state: AppState, sessions: Session[], date: ISODate): string {
  const cut = state.cut!, t = cut.targets;
  const log = state.days[date];
  const food = foodOn(state.food, date);
  const totals = totalsForAI(food, dayTotals(state.food, date));
  const lifts = liftDates(sessions);
  const prev = Array.from({ length: 7 }, (_, i) => addDays(date, -7 + i)).map((d) => {
    const x = dayTotals(state.food, d);
    return [d.slice(5), x?.kcal ?? null, x?.proteinG ?? null, state.days[d]?.steps ?? null, state.days[d]?.weightKg ?? null];
  });
  return JSON.stringify({
    date,
    targets: { kcal: t.kcal, protein: t.proteinG, fat: t.fatG, fibre: t.fibreG, stepsFloor: t.stepsFloor, stepsGoal: t.stepsGoal },
    goal: { startKg: cut.startWeightKg, goalKg: cut.goalWeightKg, by: cut.goalDate },
    totals,
    food: food.map((f) => [hhmm(f.at), cutName(f.name), f.kcal, f.proteinG]),
    steps: log?.steps ?? null,
    weightKg: log?.weightKg ?? null,
    avg7Kg: avg7(state.days, date),
    lifted: lifts.has(date) || !!log?.lifted,
    hunger: log?.hunger ?? null,
    focus: log?.workFocus ?? null,
    sleepH: log?.sleepHours ?? null,
    lateNight: log?.lateNight ?? null,
    notes: log?.notes?.slice(0, 300) ?? null,
    prev7: { cols: ["date", "kcal", "protein", "steps", "kg"], rows: prev },
  });
}

// What the weekly insight sees.
export function weekSummaryForAI(state: AppState, sessions: Session[], monday: ISODate, today: ISODate): string {
  const cut: CutSettings = state.cut!, t = cut.targets;
  const lifts = liftDates(sessions);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d <= today).map((d) => {
    const x = dayTotals(state.food, d);
    const f = foodOn(state.food, d);
    const log = state.days[d];
    return [
      parseISO(d).toLocaleDateString("en", { weekday: "short" }) + " " + d.slice(5),
      x?.kcal ?? null, x?.proteinG ?? null, f.length ? hhmm(f[0].at) : null, f.length ? hhmm(f[f.length - 1].at) : null,
      log?.steps ?? null, log?.weightKg ?? null, log?.hunger ?? null, log?.workFocus ?? null, log?.sleepHours ?? null,
      lifts.has(d) || !!log?.lifted,
    ];
  });
  const end = days.length ? addDays(monday, days.length - 1) : monday;
  return JSON.stringify({
    weekStart: monday,
    targets: { kcal: t.kcal, protein: t.proteinG, stepsFloor: t.stepsFloor, stepsGoal: t.stepsGoal, liftsPerWeek: t.liftsPerWeek },
    goal: { startKg: cut.startWeightKg, goalKg: cut.goalWeightKg, by: cut.goalDate },
    avg7Kg: { start: avg7(state.days, addDays(monday, -1)), end: avg7(state.days, end) },
    days: { cols: ["day", "kcal", "protein", "firstMeal", "lastMeal", "steps", "kg", "hunger", "focus", "sleepH", "lifted"], rows: days },
    checkin: state.checkins[monday]?.decision ?? null,
  });
}
