import type { AppState, CutSettings, CutTargets, DayLog, Decision, FoodEntry, ISODate, LegacyDayLog, MealItem, Session } from "./types";

export const KCAL_FLOOR = 1600;
export const RICE_CUP = { name: "Rice, 1 cup cooked", kcal: 200, proteinG: 4, carbsG: 45, fibreG: 1 };

// Prefill for the setup form only; the user confirms or edits every value.
export const CUT_PREFILL: CutSettings = {
  heightCm: 175,
  age: 32,
  sex: "male",
  activityFactor: 1.45,
  startDate: "2026-10-27",
  goalDate: "2026-12-15",
  startWeightKg: 85,
  goalWeightKg: 78,
  goalBandKg: [77, 79],
  targets: { kcal: 1800, proteinG: 160, fatG: 55, carbsG: 150, fibreG: 30, stepsFloor: 10000, stepsGoal: 12000, liftsPerWeek: 4 },
};

/* ---------- dates (local calendar days) ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s: ISODate) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: ISODate, n: number) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export const daysBetween = (a: ISODate, b: ISODate) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
export const mondayOf = (s: ISODate) => addDays(s, -((parseISO(s).getDay() + 6) % 7));
export const todayISO = () => isoDate(new Date());

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x: number) => Math.round(x * 100) / 100;

/* ---------- trend ---------- */

// Mean of weigh-ins in the 7 days ending on `date`; needs at least 4 of them.
export function avg7(days: Record<ISODate, DayLog>, date: ISODate): number | null {
  const ws: number[] = [];
  for (let i = 0; i < 7; i++) {
    const w = days[addDays(date, -i)]?.weightKg;
    if (w != null) ws.push(w);
  }
  return ws.length >= 4 ? r2(mean(ws)!) : null;
}

export const liftDates = (sessions: Session[]) => new Set(sessions.map((s) => isoDate(new Date(s.date))));

/* ---------- food ---------- */

export interface Totals {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fibreG: number;
}

const MACROS = ["kcal", "proteinG", "fatG", "carbsG", "fibreG"] as const;

export function sumFood(xs: Partial<Totals>[]): Totals {
  const t = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fibreG: 0 };
  for (const x of xs) for (const k of MACROS) t[k] += x[k] ?? 0;
  for (const k of MACROS) t[k] = Math.round(t[k]);
  return t;
}

// A day's entries in the order eaten.
export const foodOn = (food: Record<string, FoodEntry>, date: ISODate) =>
  Object.values(food).filter((f) => f.date === date && !f.deleted).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

// null when nothing is logged, so an empty day isn't scored as 0 kcal.
export function dayTotals(food: Record<string, FoodEntry>, date: ISODate): Totals | null {
  const es = foodOn(food, date);
  return es.length ? sumFood(es) : null;
}

export const describedName = (items: MealItem[], text: string) => items.map((i) => i.name).join(", ") || text;

// Before entries, a day held typed totals plus estimated meals. Ids are fixed so every device
// migrates a day to the same entries.
export function migrateLegacyFood(s: AppState): AppState {
  let days = s.days, food = s.food;
  for (const [date, log] of Object.entries(s.days) as [ISODate, LegacyDayLog][]) {
    const { kcal, proteinG, fatG, carbsG, fibreG, meals, ...rest } = log;
    if (kcal == null && proteinG == null && fatG == null && carbsG == null && fibreG == null && !meals) continue;
    if (days === s.days) { days = { ...s.days }; food = { ...s.food }; }
    for (const m of meals ?? []) {
      const id = `mig-${date}-${m.id}`;
      food[id] = { id, date, at: m.at, name: describedName(m.items, m.text), source: "described", text: m.text, items: m.items, ...sumFood(m.items), updatedAt: log.updatedAt };
    }
    const fromMeals = sumFood((meals ?? []).flatMap((m) => m.items));
    const left = sumFood([{ kcal, proteinG, fatG, carbsG, fibreG }]);
    for (const k of MACROS) left[k] = Math.max(0, left[k] - fromMeals[k]);
    if (left.kcal > 0 || left.proteinG > 0) {
      const id = `mig-${date}-rest`;
      food[id] = { id, date, at: parseISO(date).getTime() + 12 * 3600000, name: "Earlier total", source: "manual", ...left, updatedAt: log.updatedAt };
    }
    days[date] = rest;
  }
  return days === s.days ? s : { ...s, days, food };
}

export const saveFood = (s: AppState, e: Omit<FoodEntry, "updatedAt">, now: number): AppState =>
  ({ ...s, food: { ...s.food, [e.id]: { ...e, updatedAt: now } } });

export const deleteFood = (s: AppState, id: string, now: number): AppState =>
  s.food[id] ? { ...s, food: { ...s.food, [id]: { ...s.food[id], deleted: true, updatedAt: now } } } : s;

/* ---------- daily score ---------- */

export interface DayChecks {
  kcal: boolean | null; // null = not logged
  protein: boolean | null;
  steps: boolean | null;
  lifted: boolean;
}

export function dayChecks(t: CutTargets, totals: Totals | null, log: DayLog | undefined, lifted: boolean): DayChecks {
  return {
    kcal: totals == null ? null : Math.abs(totals.kcal - t.kcal) <= 100,
    protein: totals == null ? null : totals.proteinG >= t.proteinG,
    steps: log?.steps == null ? null : log.steps >= t.stepsFloor,
    lifted: lifted || !!log?.lifted,
  };
}

export interface WeekSummary {
  dates: ISODate[]; // elapsed days of the week, Monday first
  adherence: number | null; // 0–1 over kcal/protein/steps; unlogged counts as a miss
  avgKcal: number | null;
  avgProtein: number | null;
  avgSteps: number | null;
  lifts: number;
}

export function weekSummary(cut: CutSettings, s: Pick<AppState, "days" | "food">, lifts: Set<ISODate>, monday: ISODate, today: ISODate): WeekSummary {
  const dates: ISODate[] = [];
  for (let i = 0; i < 7 && addDays(monday, i) <= today; i++) dates.push(addDays(monday, i));
  const totals = dates.map((d) => dayTotals(s.food, d));
  let hits = 0;
  dates.forEach((d, i) => {
    const c = dayChecks(cut.targets, totals[i], s.days[d], lifts.has(d));
    hits += Number(!!c.kcal) + Number(!!c.protein) + Number(!!c.steps);
  });
  const logged = totals.filter((t): t is Totals => t != null);
  const round = (x: number | null) => (x == null ? null : Math.round(x));
  return {
    dates,
    adherence: dates.length ? hits / (dates.length * 3) : null,
    avgKcal: round(mean(logged.map((t) => t.kcal))),
    avgProtein: round(mean(logged.map((t) => t.proteinG))),
    avgSteps: round(mean(dates.map((d) => s.days[d]?.steps).filter((v): v is number => v != null))),
    lifts: dates.filter((d) => lifts.has(d) || s.days[d]?.lifted).length,
  };
}

/* ---------- energy ---------- */

// Mifflin-St Jeor
export const bmr = (c: CutSettings, kg: number) => 10 * kg + 6.25 * c.heightCm - 5 * c.age + (c.sex === "male" ? 5 : -161);
export const tdee = (c: CutSettings, kg: number) => bmr(c, kg) * c.activityFactor;

/* ---------- Monday checkpoint ---------- */

export interface CheckpointInput {
  thisWeekKg: number | null; // avg7 on this Monday
  lastWeekKg: number | null; // avg7 on the Monday before
  twoWeeksKg: number | null; // avg7 two Mondays back
  avgHunger: number | null;
  avgFocus: number | null;
  avgSteps: number | null;
}

export function checkpointInput(days: Record<ISODate, DayLog>, monday: ISODate): CheckpointInput {
  const window = Array.from({ length: 7 }, (_, i) => days[addDays(monday, -i)]).filter(Boolean) as DayLog[];
  const avgOf = (k: "hunger" | "workFocus" | "steps") => mean(window.map((d) => d[k]).filter((v): v is number => v != null));
  return {
    thisWeekKg: avg7(days, monday),
    lastWeekKg: avg7(days, addDays(monday, -7)),
    twoWeeksKg: avg7(days, addDays(monday, -14)),
    avgHunger: avgOf("hunger"),
    avgFocus: avgOf("workFocus"),
    avgSteps: avgOf("steps"),
  };
}

// Rules run in order; exactly one decision per week.
export function checkpoint(c: CutSettings, monday: ISODate, x: CheckpointInput): Decision {
  if (daysBetween(c.startDate, monday) < 7) {
    return { action: "hold", reason: "First check-in: week 1 is mostly water, so no changes yet." };
  }
  if (x.thisWeekKg == null || x.lastWeekKg == null) {
    return { action: "hold", reason: "Not enough weigh-ins to compare weeks (need 4 in each 7-day window)." };
  }
  const loss = r2(x.lastWeekKg - x.thisWeekKg);
  const struggling = (x.avgFocus != null && x.avgFocus <= 2) || (x.avgHunger != null && x.avgHunger >= 4.5);
  if (loss > 1.2 || struggling) {
    const why = loss > 1.2 ? `Lost ${loss} kg this week, faster than 1.2 kg.` : "Hunger or work focus has been rough this week.";
    return { action: "increase", kcalDelta: 150, reason: `${why} Add 150 kcal, mostly carbs at lunch.` };
  }
  const prevLoss = x.twoWeeksKg == null || daysBetween(c.startDate, addDays(monday, -7)) < 7 ? null : r2(x.twoWeeksKg - x.lastWeekKg);
  if (loss < 0.5 && prevLoss != null && prevLoss < 0.5) {
    const stepsShort = x.avgSteps != null && x.avgSteps < c.targets.stepsGoal;
    if (stepsShort || c.targets.kcal - 150 < KCAL_FLOOR) {
      return { action: "decrease", lever: "steps", amount: 2000, reason: `Under 0.5 kg lost two weeks running (${prevLoss}, then ${loss} kg). Add 2,000 steps a day.` };
    }
    return { action: "decrease", lever: "kcal", amount: 150, reason: `Under 0.5 kg lost two weeks running (${prevLoss}, then ${loss} kg). Cut 150 kcal.` };
  }
  return { action: "hold", reason: `Lost ${loss} kg this week. On track, keep going.` };
}

// Never below the calorie floor; protein is never touched.
export function applyDecision(t: CutTargets, d: Decision): CutTargets {
  if (d.action === "increase") return { ...t, kcal: t.kcal + d.kcalDelta, carbsG: t.carbsG + Math.round(d.kcalDelta / 4) };
  if (d.action === "decrease" && d.lever === "steps") return { ...t, stepsFloor: t.stepsFloor + d.amount, stepsGoal: t.stepsGoal + d.amount };
  if (d.action === "decrease") {
    const kcal = Math.max(KCAL_FLOOR, t.kcal - d.amount);
    return { ...t, kcal, carbsG: Math.max(0, t.carbsG - Math.round((t.kcal - kcal) / 4)) };
  }
  return t;
}

/* ---------- projection ---------- */

export interface Projection {
  now: number;
  ratePerWeek: number;
  low: number;
  high: number;
}

// Projects the 7-day average to the goal date using the rate over the last 2–3 weeks.
export function projection(c: CutSettings, days: Record<ISODate, DayLog>, date: ISODate): Projection | null {
  const now = avg7(days, date);
  if (now == null) return null;
  for (const weeks of [3, 2]) {
    const past = avg7(days, addDays(date, -7 * weeks));
    if (past == null) continue;
    const ratePerWeek = r2((now - past) / weeks);
    const mid = now + ratePerWeek * Math.max(0, daysBetween(date, c.goalDate) / 7);
    return { now, ratePerWeek, low: r2(mid - 0.5), high: r2(mid + 0.5) };
  }
  return null;
}
