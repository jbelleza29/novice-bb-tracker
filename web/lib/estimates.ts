import { api, ApiError, type EstimateJob } from "./api";
import { describedName, saveFood, sumFood } from "./cut";
import { store } from "./store";
import type { AppState, FoodEntry } from "./types";

const sentence = (s: string) => s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

// Fills in a pending entry from a finished job. Leaves deleted or already-filled entries alone.
export function applyJob(s: AppState, id: string, job: EstimateJob, now: number): AppState {
  const e = s.food[id];
  if (!e || e.deleted || e.estimate !== "pending" || job.status === "pending") return s;
  if (job.status === "done" && job.items?.length) {
    const items = job.items;
    return saveFood(s, { ...e, estimate: undefined, error: undefined, name: describedName(items, e.text ?? ""), items, note: job.note || undefined, ...sumFood(items) }, now);
  }
  return saveFood(s, { ...e, estimate: "failed", error: sentence(job.error || "couldn't estimate that meal") }, now);
}

function errorText(e: unknown) {
  if (!(e instanceof ApiError)) return "can't reach the server, add it manually for now";
  if (e.status === 401) return "sign in to use meal estimates";
  return (e.body as { error?: string } | null)?.error ?? "couldn't estimate that, try again";
}

const starting = new Set<string>();

export async function startEstimate(e: FoodEntry) {
  starting.add(e.id);
  let job: EstimateJob;
  try {
    job = await api.startEstimate(e.id, e.text ?? "");
  } catch (err) {
    job = { status: "failed", error: errorText(err) };
  } finally {
    starting.delete(e.id);
  }
  store.updateState((s, now) => applyJob(s, e.id, job, now));
}

// The entry open in the describe sheet; it doesn't need a banner when it finishes.
let watching: string | null = null;
export const setWatching = (id: string | null) => { watching = id; };

let checking = false;

// Asks the server about every pending entry. Returns the ones that just got filled in.
export async function checkEstimates(): Promise<FoodEntry[]> {
  const snap = store.get();
  if (checking || !snap) return [];
  checking = true;
  const filled: FoodEntry[] = [];
  try {
    for (const f of Object.values(snap.state.food)) {
      if (f.estimate !== "pending" || f.deleted || starting.has(f.id)) continue;
      let job: EstimateJob;
      try {
        job = await api.getEstimate(f.id);
      } catch (err) {
        // a job started on another device may not have reached the server yet
        if (!(err instanceof ApiError) || err.status !== 404 || Date.now() - f.updatedAt < 30000) continue;
        job = { status: "failed", error: "the estimate was lost, try again" };
      }
      if (job.status === "pending") continue;
      store.updateState((s, now) => applyJob(s, f.id, job, now));
      const e = store.get()?.state.food[f.id];
      if (e && !e.estimate && f.id !== watching) filled.push(e);
    }
  } finally {
    checking = false;
  }
  return filled;
}
