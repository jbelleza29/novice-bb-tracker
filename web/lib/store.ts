import { useSyncExternalStore } from "react";
import { api, ApiError, type RemoteState } from "./api";
import { defaultState, resetState } from "./engine";
import { mergeSessions, mergeState } from "./merge";
import type { AppState, Draft, Session } from "./types";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error" | "signed-out";

export interface Snapshot {
  state: AppState;
  sessions: Session[];
  drafts: Record<number, Draft>;
  sync: SyncStatus;
}

interface Outbox {
  state: boolean;
  sessions: string[];
}

const K = { state: "nbt-state", sessions: "nbt-sessions", drafts: "nbt-drafts", outbox: "nbt-outbox" } as const;

const LS = {
  get<T>(k: string): T | null {
    try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

// Local-first: every change lands in localStorage, then syncs to the Go API when signed in and online.
class TrackerStore {
  private snap: Snapshot | null = null;
  private outbox: Outbox = { state: false, sessions: [] };
  private rev = 0;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  get = () => this.snap;

  load() {
    if (this.snap) return;
    const state = LS.get<AppState>(K.state);
    this.snap = {
      state: state?.v === 1 ? state : defaultState(),
      sessions: LS.get<Session[]>(K.sessions) ?? [],
      drafts: LS.get<Record<number, Draft>>(K.drafts) ?? {},
      sync: "idle",
    };
    this.outbox = LS.get<Outbox>(K.outbox) ?? { state: false, sessions: [] };
    this.emit();
    window.addEventListener("online", () => void this.sync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.sync();
    });
    void this.sync();
  }

  updateState(fn: (s: AppState, now: number) => AppState) {
    this.patch({ state: fn(this.snap!.state, Date.now()) });
    this.markDirty();
  }

  updateDrafts(fn: (d: Record<number, Draft>) => Record<number, Draft>) {
    this.patch({ drafts: fn(this.snap!.drafts) });
  }

  commitWorkout(state: AppState, session: Session) {
    const drafts = { ...this.snap!.drafts };
    delete drafts[session.day];
    this.patch({ state, sessions: [session, ...this.snap!.sessions], drafts });
    this.outbox.sessions.push(session.id);
    this.markDirty();
  }

  reset() {
    this.patch({ state: resetState(Date.now()), sessions: [], drafts: {} });
    this.outbox.sessions = [];
    this.markDirty();
  }

  async login(passcode: string) {
    await api.login(passcode);
    await this.sync();
  }

  async logout() {
    await api.logout().catch(() => {});
    this.patch({ sync: "signed-out" });
  }

  sync(): Promise<void> {
    if (!this.snap) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runSync().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  private async runSync() {
    clearTimeout(this.timer);
    if (!navigator.onLine) return this.patch({ sync: "offline" });
    this.patch({ sync: "syncing" });
    try {
      const startRev = this.rev;
      let remote = await api.getState();
      for (let attempt = 0; ; attempt++) {
        const merged = remote.state ? mergeState(this.snap!.state, remote.state) : this.snap!.state;
        if (remote.state && !this.outbox.state) {
          this.adopt(merged);
          break;
        }
        try {
          await api.putState(merged, remote.version);
          this.adopt(merged);
          break;
        } catch (e) {
          // another device wrote first: merge with what it wrote and try again
          if (e instanceof ApiError && e.status === 409 && attempt < 3) {
            remote = e.body as RemoteState;
            continue;
          }
          throw e;
        }
      }
      if (this.rev === startRev) this.outbox.state = false;
      this.saveOutbox();

      const resetAt = this.snap!.state.resetAt;
      for (const id of [...this.outbox.sessions]) {
        const s = this.snap!.sessions.find((x) => x.id === id);
        if (s && Date.parse(s.date) >= resetAt) await api.putSession(s);
        this.outbox.sessions = this.outbox.sessions.filter((x) => x !== id);
        this.saveOutbox();
      }
      const remoteSessions = await api.getSessions();
      if (remoteSessions.some((s) => Date.parse(s.date) < resetAt)) {
        await api.deleteSessionsBefore(new Date(resetAt).toISOString());
      }
      this.patch({ sessions: mergeSessions(this.snap!.sessions, remoteSessions, this.snap!.state.resetAt), sync: "synced" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.patch({ sync: "signed-out" });
      else if (e instanceof TypeError) this.patch({ sync: "offline" });
      else this.patch({ sync: "error" });
    }
  }

  // Re-merge so edits made while a request was in flight survive.
  private adopt(merged: AppState) {
    const cur = this.snap!.state;
    const next = mergeState(cur, merged);
    this.patch(next.units === cur.units ? { state: next } : { state: next, drafts: {} });
  }

  private markDirty() {
    this.rev++;
    this.outbox.state = true;
    this.saveOutbox();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), 800);
  }

  private saveOutbox() {
    LS.set(K.outbox, this.outbox);
  }

  private patch(p: Partial<Snapshot>) {
    this.snap = { ...this.snap!, ...p };
    if (p.state) LS.set(K.state, p.state);
    if (p.sessions) LS.set(K.sessions, p.sessions);
    if (p.drafts) LS.set(K.drafts, p.drafts);
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const store = new TrackerStore();

export function useTracker() {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}
