import { describe, expect, it } from "vitest";
import { addDays, applyDecision, avg7, checkpoint, checkpointInput, completeCut, cutDraft, dayTotals, foodOn, migrateLegacyFood, mondayOf, projection, weekSummary } from "./cut";
import { defaultState, withDefaults } from "./engine";
import { mergeState } from "./merge";
import type { AppState, CutSettings, DayLog, FoodEntry, LegacyDayLog } from "./types";

const cut: CutSettings = {
  heightCm: 175, age: 32, sex: "male", activityFactor: 1.45,
  startDate: "2026-10-27", goalDate: "2026-12-15", // Tue start
  startWeightKg: 85, goalWeightKg: 78, goalBandKg: [77, 79],
  targets: { kcal: 1800, proteinG: 160, fatG: 55, carbsG: 150, fibreG: 30, stepsFloor: 10000, stepsGoal: 12000, liftsPerWeek: 4 },
};
const entry = (id: string, date: string, kcal: number, proteinG: number, extra: Partial<FoodEntry> = {}): FoodEntry =>
  ({ id, date, at: 1, name: id, source: "manual", kcal, proteinG, updatedAt: 1, ...extra });
const weigh = (entries: Record<string, number>) =>
  Object.fromEntries(Object.entries(entries).map(([d, w]) => [d, { weightKg: w, updatedAt: 1 } as DayLog]));
// 7 straight days of weigh-ins ending on `end`, all at `kg`
const week = (end: string, kg: number) => weigh(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays(end, -i), kg])));

describe("cut setup", () => {
  it("starts with personal fields empty and only completes when all are filled", () => {
    const d = cutDraft("2026-11-01");
    expect(d.heightCm).toBeNull();
    expect(d.startWeightKg).toBeNull();
    expect(d.targets.kcal).toBeNull();
    expect(completeCut(d)).toBeNull();
    expect(completeCut({ ...cut, goalDate: "2026-10-01" })).toBeNull();
    expect(completeCut(cut)).toEqual(cut);
  });
});

describe("avg7", () => {
  it("averages what's there when at least 4 weigh-ins exist", () => {
    expect(avg7(weigh({ "2026-11-01": 88, "2026-10-30": 87, "2026-10-28": 86, "2026-10-26": 85 }), "2026-11-01")).toBe(86.5);
  });
  it("returns null with fewer than 4", () => {
    expect(avg7(weigh({ "2026-11-01": 88, "2026-10-30": 87, "2026-10-28": 86 }), "2026-11-01")).toBeNull();
  });
});

describe("Monday checkpoint", () => {
  it("holds on the first check-in", () => {
    const days = { ...week("2026-11-02", 86) };
    expect(checkpoint(cut, "2026-11-02", checkpointInput(days, "2026-11-02")).action).toBe("hold");
  });

  it("adds calories when loss is over 1.2 kg", () => {
    const days = { ...week("2026-11-02", 87), ...week("2026-11-09", 85.5) };
    expect(checkpoint(cut, "2026-11-09", checkpointInput(days, "2026-11-09"))).toMatchObject({ action: "increase", kcalDelta: 150 });
  });

  it("adds calories when hunger is high", () => {
    const days = { ...week("2026-11-02", 87), ...week("2026-11-09", 86.2) };
    for (let i = 0; i < 7; i++) days[addDays("2026-11-09", -i)].hunger = 5;
    expect(checkpoint(cut, "2026-11-09", checkpointInput(days, "2026-11-09")).action).toBe("increase");
  });

  it("holds at a normal rate", () => {
    const days = { ...week("2026-11-02", 87), ...week("2026-11-09", 86.2) };
    expect(checkpoint(cut, "2026-11-09", checkpointInput(days, "2026-11-09")).action).toBe("hold");
  });

  it("adds steps after two stalled weeks when steps are under goal", () => {
    const days = { ...week("2026-11-09", 86), ...week("2026-11-16", 85.8), ...week("2026-11-23", 85.6) };
    for (const d of Object.values(days)) d.steps = 9000;
    expect(checkpoint(cut, "2026-11-23", checkpointInput(days, "2026-11-23"))).toMatchObject({ action: "decrease", lever: "steps", amount: 2000 });
  });

  it("cuts calories after two stalled weeks when steps are on goal", () => {
    const days = { ...week("2026-11-09", 86), ...week("2026-11-16", 85.8), ...week("2026-11-23", 85.6) };
    for (const d of Object.values(days)) d.steps = 13000;
    expect(checkpoint(cut, "2026-11-23", checkpointInput(days, "2026-11-23"))).toMatchObject({ action: "decrease", lever: "kcal" });
  });

  it("switches to steps instead of going under 1,600 kcal", () => {
    const low = { ...cut, targets: { ...cut.targets, kcal: 1700 } };
    const days = { ...week("2026-11-09", 86), ...week("2026-11-16", 85.8), ...week("2026-11-23", 85.6) };
    for (const d of Object.values(days)) d.steps = 13000;
    expect(checkpoint(low, "2026-11-23", checkpointInput(days, "2026-11-23"))).toMatchObject({ lever: "steps" });
  });

  it("never applies a calorie target below 1,600 and leaves protein alone", () => {
    const t = applyDecision({ ...cut.targets, kcal: 1650 }, { action: "decrease", lever: "kcal", amount: 150, reason: "" });
    expect(t.kcal).toBe(1600);
    expect(t.proteinG).toBe(cut.targets.proteinG);
  });
});

describe("projection and weekly summary", () => {
  it("projects a ±0.5 kg range to the goal date", () => {
    const days = { ...week("2026-11-09", 87), ...week("2026-11-30", 85.2) };
    const p = projection(cut, days, "2026-11-30")!;
    expect(p.ratePerWeek).toBe(-0.6);
    expect(p.high - p.low).toBeCloseTo(1);
    expect(p.low).toBeCloseTo(83.41, 2); // 85.2 - 0.6 * 15/7 - 0.5
  });

  it("counts lifts from logged workouts and unlogged days as misses", () => {
    const monday = mondayOf("2026-11-11");
    const days: Record<string, DayLog> = { [monday]: { steps: 11000, updatedAt: 1 } };
    const food = { a: entry("a", monday, 1100, 90), b: entry("b", monday, 700, 80) };
    const s = weekSummary(cut, { days, food }, new Set([monday, "2026-11-11"]), monday, "2026-11-11");
    expect(s.dates).toHaveLength(3);
    expect(s.adherence).toBeCloseTo(3 / 9);
    expect(s.lifts).toBe(2);
  });

  it("merges day logs per day", () => {
    const a = { ...defaultState(), days: { "2026-11-01": { weightKg: 88, updatedAt: 5 } } };
    const b = { ...defaultState(), days: { "2026-11-01": { weightKg: 87.9, updatedAt: 3 }, "2026-11-02": { weightKg: 87.5, updatedAt: 4 } } };
    expect(mergeState(a, b).days).toEqual({ "2026-11-01": { weightKg: 88, updatedAt: 5 }, "2026-11-02": { weightKg: 87.5, updatedAt: 4 } });
  });
});

describe("food entries", () => {
  it("totals a day and skips deleted entries", () => {
    const food = { a: entry("a", "2026-11-01", 400, 30), b: entry("b", "2026-11-01", 250, 20, { deleted: true }), c: entry("c", "2026-11-02", 900, 50) };
    expect(dayTotals(food, "2026-11-01")).toMatchObject({ kcal: 400, proteinG: 30 });
    expect(dayTotals(food, "2026-11-03")).toBeNull();
  });

  it("moves typed totals and estimated meals into entries, once", () => {
    const legacy: LegacyDayLog = {
      weightKg: 88, kcal: 685, proteinG: 56, updatedAt: 7,
      meals: [{ id: "m1", text: "rice and egg", at: 5, items: [{ name: "Rice", portion: "1 cup", kcal: 205, proteinG: 4, fatG: 0, carbsG: 45, fibreG: 1 }, { name: "Egg", portion: "1", kcal: 70, proteinG: 6, fatG: 5, carbsG: 1, fibreG: 0 }] }],
    };
    const s = migrateLegacyFood({ ...defaultState(), days: { "2026-11-01": legacy } } as AppState);
    expect(s.days["2026-11-01"]).toEqual({ weightKg: 88, updatedAt: 7 });
    expect(foodOn(s.food, "2026-11-01").map((f) => [f.name, f.kcal, f.proteinG])).toEqual([["Rice, Egg", 275, 10], ["Earlier total", 410, 46]]);
    expect(migrateLegacyFood(s)).toBe(s);
    expect(withDefaults(s).food).toEqual(s.food);
  });

  it("syncs entries one by one, and a delete beats an older copy", () => {
    const phone = { ...defaultState(), food: { a: entry("a", "2026-11-01", 400, 30, { updatedAt: 5 }), b: entry("b", "2026-11-01", 200, 10, { deleted: true, updatedAt: 9 }) } };
    const laptop = { ...defaultState(), food: { b: entry("b", "2026-11-01", 200, 10, { updatedAt: 3 }), c: entry("c", "2026-11-01", 300, 25, { updatedAt: 6 }) } };
    expect(foodOn(mergeState(laptop, phone).food, "2026-11-01").map((f) => f.id)).toEqual(["a", "c"]);
  });
});

describe("day recap", () => {
  it("states totals against targets and the protein gap", async () => {
    const { dayRecap, daySummary } = await import("./recap");
    const s = { ...defaultState(), cut, days: { "2026-11-01": { steps: 10500, weightKg: 84.6, updatedAt: 1 } },
      food: { a: entry("a", "2026-11-01", 700, 55, { at: new Date(2026, 10, 1, 13, 5).getTime() }), b: entry("b", "2026-11-01", 1050, 60, { at: new Date(2026, 10, 1, 19, 40).getTime() }) } };
    const r = dayRecap(s, [], "2026-11-01");
    expect(r.lines).toContain("1,750 of 1,800 kcal, on target.");
    expect(r.lines).toContain("Protein 115 of 160 g, 45 g short.");
    expect(r.lines).toContain("10,500 steps: floor met, 1,500 short of the goal.");
    const sent = JSON.parse(daySummary(s, [], "2026-11-01"));
    expect(sent.food).toEqual([["13:05", "a", 700, 55], ["19:40", "b", 1050, 60]]);
    expect(sent.totals).toEqual({ kcal: 1750, protein: 115, fat: null, carbs: null, fibre: null });
  });
});
