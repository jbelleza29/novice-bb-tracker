import { convertSlot } from "./engine";
import { SLOT } from "./program";
import type { AppState, Session, SlotState } from "./types";

// Newest wins per slot and per settings group; ties go to the remote copy.
// Anything stamped before the latest "Delete all data" is dropped.
export function mergeState(local: AppState, remote: AppState): AppState {
  const resetAt = Math.max(local.resetAt, remote.resetAt);
  const set = remote.settingsAt >= local.settingsAt ? remote : local;
  const rot = remote.nextDayAt >= local.nextDayAt ? remote : local;

  const slots: Record<string, SlotState> = {};
  for (const id of new Set([...Object.keys(local.slots), ...Object.keys(remote.slots)])) {
    const a = local.slots[id], b = remote.slots[id];
    const pick = !a ? b : !b ? a : b.updatedAt >= a.updatedAt ? b : a;
    if (pick.updatedAt < resetAt || !SLOT[id]) continue;
    slots[id] = convertSlot(pick, SLOT[id], set.units);
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
  };
}

export function mergeSessions(local: Session[], remote: Session[], resetAt: number): Session[] {
  const byId = new Map<string, Session>();
  for (const s of [...local, ...remote]) byId.set(s.id, s);
  return [...byId.values()].filter((s) => Date.parse(s.date) >= resetAt).sort((a, b) => b.date.localeCompare(a.date));
}
