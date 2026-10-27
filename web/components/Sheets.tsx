import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { fmt, type Result } from "@/lib/engine";
import { store } from "@/lib/store";
import type { Units } from "@/lib/types";

export function SummarySheet({ day, nextDay, results, units, onClose }: {
  day: number;
  nextDay: number;
  results: Result[];
  units: Units;
  onClose: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);

  return (
    <div className="sheet-wrap">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="doneTitle">
        <h3 id="doneTitle">Workout logged</h3>
        <p style={{ margin: 0, color: "var(--muted)" }}>Here’s what changes next time you train Day {day}.</p>
        <ul>
          {results.map((r, i) => (
            <li key={i} className={r.kind}>
              <b>{r.name}{r.next != null ? `: ${fmt(r.next)} ${units}` : ""}</b>
              <span>{r.why}</span>
            </li>
          ))}
        </ul>
        <button ref={btn} className="primary" onClick={onClose}>Go to Day {nextDay}</button>
      </div>
    </div>
  );
}

export function LoginSheet({ onClose }: { onClose: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await store.login(passcode);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401 ? "Wrong passcode."
        : err instanceof ApiError && err.status === 429 ? "Too many attempts. Try again in 15 minutes."
        : "Can’t reach the server. Your log is still saved on this device.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="loginTitle" onSubmit={submit}>
        <h3 id="loginTitle">Sign in to sync</h3>
        <p style={{ margin: 0, color: "var(--muted)" }}>Your log syncs between your devices once you sign in.</p>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          aria-label="Passcode"
          placeholder="Passcode"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {error && <p className="err">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={busy || !passcode}>{busy ? "Signing in…" : "Sign in"}</button>
          <button type="button" className="ghost" onClick={onClose}>Not now</button>
        </div>
      </form>
    </div>
  );
}
