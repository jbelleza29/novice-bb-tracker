"use client";

import { useEffect, useState } from "react";
import { store, useTracker, type SyncStatus } from "@/lib/store";
import type { Result } from "@/lib/engine";
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

  useEffect(() => store.load(), []);

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
            <h1>Novice Bodybuilding</h1>
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
          <CutView snap={snap} />
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
