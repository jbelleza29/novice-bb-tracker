import type { CutSettings, CutTargets, DayLog, Decision, ISODate, Session } from "./types";

export const KCAL_FLOOR = 1600;
export const RICE_CUP = { kcal: 200, carbsG: 45 }; // 1 cup cooked white rice

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

/* ---------- daily score ---------- */

export interface DayChecks {
  kcal: boolean | null; // null = not logged
  protein: boolean | null;
  steps: boolean | null;
  lifted: boolean;
}

export function dayChecks(t: CutTargets, log: DayLog | undefined, lifted: boolean): DayChecks {
  return {
    kcal: log?.kcal == null ? null : Math.abs(log.kcal - t.kcal) <= 100,
    protein: log?.proteinG == null ? null : log.proteinG >= t.proteinG,
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

export function weekSummary(cut: CutSettings, days: Record<ISODate, DayLog>, lifts: Set<ISODate>, monday: ISODate, today: ISODate): WeekSummary {
  const dates: ISODate[] = [];
  for (let i = 0; i < 7 && addDays(monday, i) <= today; i++) dates.push(addDays(monday, i));
  let hits = 0;
  for (const d of dates) {
    const c = dayChecks(cut.targets, days[d], lifts.has(d));
    hits += Number(!!c.kcal) + Number(!!c.protein) + Number(!!c.steps);
  }
  const vals = (k: "kcal" | "proteinG" | "steps") => dates.map((d) => days[d]?.[k]).filter((v): v is number => v != null);
  const round = (x: number | null) => (x == null ? null : Math.round(x));
  return {
    dates,
    adherence: dates.length ? hits / (dates.length * 3) : null,
    avgKcal: round(mean(vals("kcal"))),
    avgProtein: round(mean(vals("proteinG"))),
    avgSteps: round(mean(vals("steps"))),
    lifts: dates.filter((d) => lifts.has(d) || days[d]?.lifted).length,
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
