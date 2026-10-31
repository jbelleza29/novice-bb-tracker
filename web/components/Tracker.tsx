"use client";

import { useEffect, useState } from "react";
import { store, useTracker, type SyncStatus } from "@/lib/store";
import type { Result } from "@/lib/engine";
import { checkEstimates } from "@/lib/estimates";
import type { FoodEntry } from "@/lib/types";
import type { Focus } from "./CutToday";
import CutView from "./CutView";
import HistoryView from "./HistoryView";
import RestTimer, { type Timer } from "./RestTimer";
import SettingsView from "./SettingsView";
import { LoginSheet, SummarySheet } from "./Sheets";
import WorkoutView from "./WorkoutView";

type View = "workout" | "cut" | "history" | "settings";

const SYNC_TEXT: Record<SyncStatus, string> = {
  idle: "",
  syncing: "Syncing…",
  synced: "Synced",
  offline: "Offline. Saved on this device.",
  error: "Couldn’t sync. Saved on this device.",
  "signed-out": "Sign in to sync",
};

export default function Tracker() {
  const snap = useTracker();
  const [view, setView] = useState<View>("workout");
  const [day, setDay] = useState<number | null>(null);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [summary, setSummary] = useState<{ day: number; nextDay: number; results: Result[] } | null>(null);
  const [login, setLogin] = useState(false);
  const [checkin, setCheckin] = useState<Record<number, boolean>>({});
  const [ready, setReady] = useState<FoodEntry | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => store.load(), []);

  // Poll while any meal estimate is running, and again when the app comes back to the front.
  const pending = snap ? Object.values(snap.state.food).filter((f) => f.estimate === "pending" && !f.deleted).map((f) => f.id).join() : "";
  useEffect(() => {
    if (!pending) return;
    // filling in the last estimate ends this effect before its result lands, so no "still mounted" check
    const tick = () => void checkEstimates().then((done) => done.length && setReady(done[done.length - 1]));
    tick();
    const id = setInterval(tick, 2500);
    const onShow = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [pending]);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => setReady(null), 10000);
    return () => clearTimeout(id);
  }, [ready]);

  const go = (v: View) => {
    setView(v);
    window.scrollTo(0, 0);
  };

  const activeDay = day ?? snap?.state.nextDay ?? 1;

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <h1>Overkill Tracker</h1>
            {snap?.sync === "signed-out" ? (
              <button className="sync" onClick={() => setLogin(true)}>{SYNC_TEXT["signed-out"]}</button>
            ) : (
              <span className="sync" role="status">{snap ? SYNC_TEXT[snap.sync] : ""}</span>
            )}
          </div>
          <nav className="nav" aria-label="Sections">
            {(["workout", "cut", "history", "settings"] as const).map((v) => (
              <button key={v} aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </nav>
          {ready && (
            <button className="ready" onClick={() => { setFocus({ id: ready.id, date: ready.date, n: Date.now() }); setReady(null); go("cut"); }}>
              <span className="ready-text"><b>Estimate ready · {ready.kcal.toLocaleString()} kcal</b><span>{ready.name}</span></span>
              <span className="ready-go">Review</span>
            </button>
          )}
        </div>
      </header>

      <main>
        {!snap ? (
          <div className="loading">Loading your training log…</div>
        ) : view === "workout" ? (
          <WorkoutView
            snap={snap}
            day={activeDay}
            onDay={(d) => { setDay(d); window.scrollTo(0, 0); }}
            onRest={(sec, label) => setTimer({ end: Date.now() + sec * 1000, total: sec * 1000, label })}
            onStopRest={() => setTimer(null)}
            onFinished={(s) => { setTimer(null); setDay(s.day); setSummary(s); }}
          />
        ) : view === "cut" ? (
          <CutView snap={snap} focus={focus} />
        ) : view === "history" ? (
          <HistoryView sessions={snap.sessions} checkin={checkin} onCheckin={setCheckin} />
        ) : (
          <SettingsView snap={snap} onSignIn={() => setLogin(true)} />
        )}
      </main>

      {timer && (
        <RestTimer
          timer={timer}
          onAdd={() => setTimer({ ...timer, end: timer.end + 30000, total: timer.total + 30000 })}
          onClose={() => setTimer(null)}
        />
      )}

      {summary && (
        <SummarySheet
          {...summary}
          units={snap!.state.units}
          onClose={() => {
            setSummary(null);
            setDay(summary.nextDay);
            window.scrollTo(0, 0);
          }}
        />
      )}

      {login && <LoginSheet onClose={() => setLogin(false)} />}
    </>
  );
}
