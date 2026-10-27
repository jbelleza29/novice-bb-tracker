import { useState } from "react";
import { editSlot, fmt, incFor, num, slotStateOf, switchUnits, variantOf } from "@/lib/engine";
import { PROGRAM, TOP } from "@/lib/program";
import { store, type Snapshot } from "@/lib/store";
import type { Draft, Mode, SlotState } from "@/lib/types";

const dropDraft = (day: number) =>
  store.updateDrafts((all) => {
    const next = { ...all };
    delete next[day];
    return next;
  });

const dropUntouchedDrafts = () =>
  store.updateDrafts((all) =>
    Object.fromEntries(Object.entries(all).filter(([, d]) => Object.values((d as Draft).ex).some((x) => x.sets.some((s) => s.done)))),
  );

export default function SettingsView({ snap, onSignIn }: { snap: Snapshot; onSignIn: () => void }) {
  const { state } = snap;
  const u = state.units;
  const signedIn = snap.sync !== "signed-out" && snap.sync !== "idle";

  const setSlot = (id: string, day: number, patch: Partial<SlotState>) => {
    store.updateState((s, now) => editSlot(s, id, patch, now));
    dropDraft(day);
  };

  return (
    <>
      <div className="card">
        <h3>General</h3>
        <div className="row">
          <span>Units</span>
          <div className="seg">
            {(["kg", "lb"] as const).map((x) => (
              <button
                key={x}
                aria-pressed={u === x}
                onClick={() => {
                  if (x === u) return;
                  store.updateState((s, now) => switchUnits(s, x, now));
                  store.updateDrafts(() => ({}));
                }}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span>Ease-in first session<br /><small>One set fewer the first time you do each exercise</small></span>
          <button
            className="switch"
            role="switch"
            aria-checked={state.easeIn}
            aria-label="Ease-in first session"
            onClick={() => {
              store.updateState((s, now) => ({ ...s, easeIn: !s.easeIn, settingsAt: now }));
              dropUntouchedDrafts();
            }}
          />
        </div>
        <div className="row">
          <span>Sync<br /><small>{signedIn ? "Your log syncs between devices." : "Saved in this browser only."}</small></span>
          {signedIn ? (
            <button className="link" onClick={() => void store.logout()}>Sign out</button>
          ) : (
            <button className="link" onClick={onSignIn}>Sign in</button>
          )}
        </div>
      </div>

      {PROGRAM.map((d) => (
        <div className="card" key={d.day}>
          <h3>Day {d.day}: {d.title} ({d.focus.toLowerCase()})</h3>
          <p>Set your exercise, current load, jump size and method.</p>
          {d.slots.map((slot) => {
            const st = slotStateOf(state, slot.id);
            return (
              <div className="slotcfg" key={slot.id}>
                <div className="lbl">{slot.name} <span>{slot.sets} × {slot.reps}</span></div>
                <div className="grid">
                  <label className="full">
                    Exercise
                    <select
                      value={variantOf(state, slot)}
                      onChange={(e) => {
                        const v = e.target.value;
                        store.updateState((s, now) => ({ ...s, variants: { ...s.variants, [slot.id]: v }, settingsAt: now }));
                      }}
                    >
                      {slot.variants.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    Next load ({u})
                    <NumField
                      value={st.weight}
                      placeholder="Not set"
                      onChange={(text) =>
                        setSlot(slot.id, d.day, { weight: text.trim() === "" ? null : num(text), reason: "Load set manually.", kind: "new" })
                      }
                    />
                  </label>
                  <label>
                    Jump size ({u})
                    <NumField
                      value={incFor(st, slot, u)}
                      onChange={(text) => {
                        const n = num(text);
                        if (n && n > 0) setSlot(slot.id, d.day, { inc: n });
                      }}
                    />
                  </label>
                  <label className="full">
                    Progression
                    <select value={st.mode} onChange={(e) => setSlot(slot.id, d.day, { mode: e.target.value as Mode, holds: 0 })}>
                      <option value="linear">Linear: add load every session</option>
                      <option value="adp">Rep range: {slot.reps}–{TOP[slot.reps]} reps, then add load</option>
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div className="card">
        <h3>Start over</h3>
        <p>Deletes every logged workout and all saved loads{signedIn ? " on all your devices" : ""}. This can’t be undone.</p>
        <button
          className="danger"
          onClick={() => {
            if (confirm("Delete every workout and saved load? This can’t be undone.")) store.reset();
          }}
        >
          Delete all data
        </button>
      </div>
    </>
  );
}

// Keeps the typed text (e.g. "62.") while the stored number is 62; resyncs when the number changes elsewhere.
function NumField({ value, placeholder, onChange }: { value: number | null; placeholder?: string; onChange: (text: string) => void }) {
  const [text, setText] = useState(fmt(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (num(text) !== value) setText(fmt(value));
  }
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}
