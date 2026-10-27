import { PROGRAM, SLOT, STALL_LIMIT, TOP } from "./program";
import type { AppState, Draft, DraftExercise, Kind, LoggedExercise, Session, Slot, SlotState, Units } from "./types";

export const fmt = (n: number | string | null | undefined) =>
  n == null || n === "" || isNaN(Number(n)) ? "" : String(Math.round(Number(n) * 100) / 100);
export const num = (v: unknown) => {
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
};
const roundTo = (x: number, step: number, mode: "round" | "floor" | "ceil" = "round") => Math[mode](x / step) * step;
const round2 = (x: number) => Math.round(x * 100) / 100;

export const defaultState = (): AppState => ({
  v: 1, units: "kg", easeIn: true, variants: {}, settingsAt: 0, nextDay: 1, nextDayAt: 0, slots: {}, resetAt: 0,
});

export const newSlotState = (units: Units): SlotState => ({
  weight: null, mode: "linear", holds: 0, count: 0, inc: null, reason: "", kind: "new", units, updatedAt: 0,
});

export const slotStateOf = (s: AppState, id: string) => s.slots[id] ?? newSlotState(s.units);
export const variantOf = (s: AppState, slot: Slot) => s.variants[slot.id] || slot.variants[0];
export const incFor = (st: SlotState, slot: Slot, units: Units) => st.inc ?? (units === "kg" ? slot.incKg : slot.incLb);
const stepFor = (st: SlotState, slot: Slot, units: Units) => Math.min(incFor(st, slot, units), units === "kg" ? 2.5 : 5);

export interface Plan {
  sets: number;
  easing: boolean;
  range: [number, number] | null;
  weight: number | null;
}

export function planFor(s: AppState, slot: Slot): Plan {
  const st = slotStateOf(s, slot.id);
  const easing = s.easeIn && st.count === 0;
  return {
    sets: easing ? Math.max(1, slot.sets - 1) : slot.sets,
    easing,
    range: st.mode === "adp" ? [slot.reps, TOP[slot.reps]] : null,
    weight: st.weight,
  };
}

export interface Outcome {
  kind: Kind;
  why: string;
  next: number;
}

// Runs once per exercise when a workout is finished. Returns null when no set was logged.
export function evaluate(s: AppState, slot: Slot, ex: DraftExercise, now: number): { st: SlotState; out: Outcome } | null {
  const st = { ...slotStateOf(s, slot.id) };
  const u = s.units, inc = incFor(st, slot, u), step = stepFor(st, slot, u);
  const done = ex.sets.filter((x) => x.done && x.r > 0 && num(x.w) !== null);
  if (!done.length) return null;
  const w1 = num(done[0].w)!, wLast = num(done[done.length - 1].w)!;
  const rir = ex.rir ?? 2;
  const easing = s.easeIn && st.count === 0;
  let next: number, kind: Kind, why: string;

  if (st.mode === "linear") {
    const allHit = done.length >= ex.sets.length && done.every((x) => x.r >= slot.reps);
    if (easing) {
      next = wLast; kind = "hold";
      why = "Same load, but all " + slot.sets + " sets next time (first-week ease-in).";
    } else if (allHit && rir >= 2) {
      next = wLast + inc; kind = "up"; st.holds = 0;
      why = "+" + fmt(inc) + " " + u + ": every rep hit with 2+ reps in reserve.";
    } else {
      st.holds++; next = wLast; kind = "hold";
      why = allHit ? "Same load: the first set felt hard (under 2 in reserve)."
                   : "Same load: some reps were missed. Aim to hit them all.";
      if (st.holds >= STALL_LIMIT) {
        st.mode = "adp"; st.holds = 0; kind = "switch";
        why = STALL_LIMIT + " sessions without a jump, so linear gains have run their course. Switching to rep-range progression: " +
              slot.reps + "–" + TOP[slot.reps] + " reps. Add reps first, then load.";
      }
    }
  } else {
    const lo = slot.reps, hi = TOP[slot.reps], r1 = done[0].r;
    if (r1 >= hi && rir >= 2) {
      const bump = Math.max(inc, roundTo(w1 * 0.04 * (r1 - hi), step, "ceil"));
      next = w1 + bump; kind = "up";
      why = "+" + fmt(bump) + " " + u + ": first set reached " + hi + " reps at 2 in reserve. Expect fewer reps next time.";
    } else if (r1 < lo) {
      const short = lo - r1;
      next = wLast !== w1 ? wLast : Math.max(0, roundTo(w1 * (1 - 0.04 * short), step, "floor"));
      kind = "down";
      why = "Lighter: your first set was " + short + (short === 1 ? " rep" : " reps") + " under " + lo + ". About 4% less per missing rep.";
    } else {
      next = wLast; kind = "hold";
      why = "Same load: beat " + r1 + " reps on your first set. Load goes up at " + hi + " reps with 2 in reserve.";
    }
  }
  st.weight = Math.max(0, round2(next));
  st.count++; st.reason = why; st.kind = kind; st.units = u; st.updatedAt = now;
  return { st, out: { kind, why, next: st.weight } };
}

export function buildDraft(s: AppState, day: number): Draft {
  const ex: Record<string, DraftExercise> = {};
  for (const slot of PROGRAM[day - 1].slots) {
    const p = planFor(s, slot);
    ex[slot.id] = { rir: null, sets: Array.from({ length: p.sets }, () => ({ w: p.weight == null ? "" : fmt(p.weight), r: slot.reps, done: false })) };
  }
  return { day, started: Date.now(), ex };
}

export type Result = { name: string; kind: Kind | "skip"; why: string; next?: number };

export function finishWorkout(s: AppState, draft: Draft, now: number):
  | { error: string }
  | { state: AppState; session: Session; results: Result[] } {
  const all = Object.values(draft.ex).flatMap((x) => x.sets);
  if (!all.some((x) => x.done)) return { error: "Tick at least one set before finishing." };
  if (all.some((x) => x.done && num(x.w) === null)) return { error: "A ticked set has no load. Enter one (0 is fine for bodyweight)." };

  const slots = { ...s.slots };
  const results: Result[] = [], log: LoggedExercise[] = [];
  for (const slot of PROGRAM[draft.day - 1].slots) {
    const ex = draft.ex[slot.id];
    const name = variantOf(s, slot);
    const r = ex && evaluate(s, slot, ex, now);
    if (!r) { results.push({ name, kind: "skip", why: "Skipped, so nothing changes." }); continue; }
    slots[slot.id] = r.st;
    results.push({ name, ...r.out });
    log.push({ slot: slot.id, name, rir: ex.rir ?? 2, kind: r.out.kind, why: r.out.why,
      sets: ex.sets.filter((x) => x.done).map((x) => ({ w: num(x.w)!, r: x.r })) });
  }
  const session: Session = { id: "s" + now, date: new Date(now).toISOString(), day: draft.day, units: s.units, ex: log };
  return { state: { ...s, slots, nextDay: (draft.day % 4) + 1, nextDayAt: now }, session, results };
}

export function convertSlot(st: SlotState, slot: Slot, to: Units): SlotState {
  if (st.units === to) return st;
  const f = to === "lb" ? 2.20462 : 1 / 2.20462;
  const out = { ...st, units: to };
  if (out.inc != null) out.inc = Math.max(to === "kg" ? 1.25 : 2.5, roundTo(out.inc * f, to === "kg" ? 1.25 : 2.5));
  if (out.weight != null) out.weight = round2(roundTo(out.weight * f, stepFor(out, slot, to)));
  return out;
}

export function switchUnits(s: AppState, to: Units, now: number): AppState {
  const slots: Record<string, SlotState> = {};
  for (const [id, st] of Object.entries(s.slots)) if (SLOT[id]) slots[id] = convertSlot(st, SLOT[id], to);
  return { ...s, units: to, slots, settingsAt: now };
}

export function editSlot(s: AppState, id: string, patch: Partial<SlotState>, now: number): AppState {
  return { ...s, slots: { ...s.slots, [id]: { ...slotStateOf(s, id), ...patch, units: s.units, updatedAt: now } } };
}

export function resetState(now: number): AppState {
  return { ...defaultState(), settingsAt: now, nextDayAt: now, resetAt: now };
}
