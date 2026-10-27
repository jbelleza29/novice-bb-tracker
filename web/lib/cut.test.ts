import { describe, expect, it } from "vitest";
import { addDays, applyDecision, avg7, checkpoint, checkpointInput, CUT_PREFILL, mondayOf, projection, weekSummary } from "./cut";
import { defaultState } from "./engine";
import { mergeState } from "./merge";
import type { DayLog } from "./types";

const cut = CUT_PREFILL; // starts Tue 2026-10-27
const weigh = (entries: Record<string, number>) =>
  Object.fromEntries(Object.entries(entries).map(([d, w]) => [d, { weightKg: w, updatedAt: 1 } as DayLog]));
// 7 straight days of weigh-ins ending on `end`, all at `kg`
const week = (end: string, kg: number) => weigh(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays(end, -i), kg])));

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
    const days: Record<string, DayLog> = { [monday]: { kcal: 1800, proteinG: 170, steps: 11000, updatedAt: 1 } };
    const s = weekSummary(cut, days, new Set([monday, "2026-11-11"]), monday, "2026-11-11");
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
