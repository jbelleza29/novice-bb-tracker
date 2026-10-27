import { describe, expect, it } from "vitest";
import { defaultState, evaluate } from "./engine";
import { mergeSessions, mergeState } from "./merge";
import { SLOT } from "./program";
import type { AppState, DraftExercise, SlotState } from "./types";

const squat = SLOT["d1-squat"];

const ex = (w: number, reps: number[], rir: number | null = 2): DraftExercise => ({
  rir,
  sets: reps.map((r) => ({ w: String(w), r, done: true })),
});

const withSlot = (patch: Partial<SlotState>, base: Partial<AppState> = {}): AppState => ({
  ...defaultState(),
  ...base,
  slots: { [squat.id]: { weight: 60, mode: "linear", holds: 0, count: 1, inc: null, reason: "", kind: "up", units: "kg", updatedAt: 1, ...patch } },
});

describe("linear progression", () => {
  it("holds the load during the ease-in session", () => {
    const r = evaluate(defaultState(), squat, ex(60, [5, 5]), 10)!;
    expect(r.out).toMatchObject({ kind: "hold", next: 60 });
    expect(r.st.count).toBe(1);
  });

  it("adds the jump when every rep is hit at RIR 2", () => {
    expect(evaluate(withSlot({}), squat, ex(60, [5, 5, 5]), 10)!.out).toMatchObject({ kind: "up", next: 65 });
  });

  it("holds at RIR 1", () => {
    const r = evaluate(withSlot({}), squat, ex(60, [5, 5, 5], 1), 10)!;
    expect(r.out).toMatchObject({ kind: "hold", next: 60 });
    expect(r.st.holds).toBe(1);
  });

  it("holds after a missed rep", () => {
    expect(evaluate(withSlot({}), squat, ex(60, [5, 5, 4]), 10)!.out.kind).toBe("hold");
  });

  it("switches to rep-range mode after 3 holds in a row", () => {
    const r = evaluate(withSlot({ holds: 2 }), squat, ex(60, [5, 5, 4]), 10)!;
    expect(r.out.kind).toBe("switch");
    expect(r.st).toMatchObject({ mode: "adp", holds: 0 });
  });

  it("returns null when nothing was ticked", () => {
    expect(evaluate(withSlot({}), squat, { rir: null, sets: [{ w: "60", r: 5, done: false }] }, 10)).toBeNull();
  });
});

describe("rep-range progression", () => {
  it("adds load once set 1 reaches the top of the range", () => {
    expect(evaluate(withSlot({ mode: "adp", weight: 70 }), squat, ex(70, [7, 6, 6]), 10)!.out).toMatchObject({ kind: "up", next: 75 });
  });

  it("goes lighter in 2.5 kg steps when set 1 falls short", () => {
    expect(evaluate(withSlot({ mode: "adp", weight: 75 }), squat, ex(75, [3, 3, 3]), 10)!.out).toMatchObject({ kind: "down", next: 67.5 });
  });
});

describe("sync merge", () => {
  it("keeps the newer slot from each side", () => {
    const phone = withSlot({ weight: 65, updatedAt: 200 });
    const laptop = { ...withSlot({ weight: 60, updatedAt: 100 }), easeIn: false, settingsAt: 150 };
    const m = mergeState(laptop, phone);
    expect(m.slots[squat.id].weight).toBe(65);
    expect(m.easeIn).toBe(false);
  });

  it("drops data older than a reset", () => {
    const reset = { ...defaultState(), resetAt: 500, settingsAt: 500, nextDayAt: 500 };
    expect(mergeState(withSlot({ updatedAt: 100 }), reset).slots).toEqual({});
    expect(mergeSessions([{ id: "a", date: new Date(100).toISOString(), day: 1, units: "kg", ex: [] }], [], 500)).toEqual([]);
  });

  it("converts slots logged in other units", () => {
    const lb = { ...defaultState(), units: "lb" as const, settingsAt: 300 };
    expect(mergeState(withSlot({ weight: 100, updatedAt: 200 }), lb).slots[squat.id]).toMatchObject({ units: "lb", weight: 220 });
  });
});
