import { convertSlot, withDefaults } from "./engine";
import { SLOT } from "./program";
import type { AppState, Session, SlotState } from "./types";

type Stamped = { updatedAt: number };

// Per key: newest wins, ties go to the remote copy, anything older than the last reset is dropped.
function mergeMap<T extends Stamped>(local: Record<string, T>, remote: Record<string, T>, resetAt: number): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[k], b = remote[k];
    const pick = !a ? b : !b ? a : b.updatedAt >= a.updatedAt ? b : a;
    if (pick.updatedAt >= resetAt) out[k] = pick;
  }
  return out;
}

// Newest wins per slot, per day log, per check-in and per settings group.
export function mergeState(localIn: AppState, remoteIn: AppState): AppState {
  const local = withDefaults(localIn), remote = withDefaults(remoteIn);
  const resetAt = Math.max(local.resetAt, remote.resetAt);
  const set = remote.settingsAt >= local.settingsAt ? remote : local;
  const rot = remote.nextDayAt >= local.nextDayAt ? remote : local;
  const cut = remote.cutAt >= local.cutAt ? remote : local;

  const slots: Record<string, SlotState> = {};
  for (const [id, st] of Object.entries(mergeMap(local.slots, remote.slots, resetAt))) {
    if (SLOT[id]) slots[id] = convertSlot(st, SLOT[id], set.units);
  }

  return {
    v: 1,
    units: set.units,
    easeIn: set.easeIn,
    variants: set.variants,
    settingsAt: set.settingsAt,
    nextDay: rot.nextDay,
    nextDayAt: rot.nextDayAt,
    slots,
    resetAt,
    cut: cut.cut,
    cutAt: cut.cutAt,
    days: mergeMap(local.days, remote.days, resetAt),
    checkins: mergeMap(local.checkins, remote.checkins, resetAt),
  };
}

export function mergeSessions(local: Session[], remote: Session[], resetAt: number): Session[] {
  const byId = new Map<string, Session>();
  for (const s of [...local, ...remote]) byId.set(s.id, s);
  return [...byId.values()].filter((s) => Date.parse(s.date) >= resetAt).sort((a, b) => b.date.localeCompare(a.date));
}
