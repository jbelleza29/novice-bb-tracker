import { useState } from "react";
import { buildDraft, finishWorkout, fmt, planFor, slotStateOf, variantOf, type Result } from "@/lib/engine";
import { PROGRAM } from "@/lib/program";
import { store, type Snapshot } from "@/lib/store";
import type { Draft, DraftExercise, Slot } from "@/lib/types";

interface Props {
  snap: Snapshot;
  day: number;
  onDay: (day: number) => void;
  onRest: (seconds: number, label: string) => void;
  onStopRest: () => void;
  onFinished: (summary: { day: number; nextDay: number; results: Result[] }) => void;
}

export default function WorkoutView({ snap, day, onDay, onRest, onStopRest, onFinished }: Props) {
  const { state } = snap;
  const program = PROGRAM[day - 1];
  // Untouched days aren't stored, so they always reflect the latest plan.
  const draft = snap.drafts[day] ?? buildDraft(state, day);
  const [error, setError] = useState("");

  const editExercise = (slotId: string, fn: (ex: DraftExercise) => DraftExercise) => {
    store.updateDrafts((all) => {
      const d: Draft = all[day] ?? draft;
      return { ...all, [day]: { ...d, ex: { ...d.ex, [slotId]: fn(d.ex[slotId]) } } };
    });
  };

  const finish = () => {
    const r = finishWorkout(state, draft, Date.now());
    if ("error" in r) return setError(r.error);
    setError("");
    store.commitWorkout(r.state, r.session);
    onFinished({ day, nextDay: r.state.nextDay, results: r.results });
  };

  const discard = () => {
    if (!confirm("Discard what you’ve logged for this workout?")) return;
    store.updateDrafts((all) => {
      const next = { ...all };
      delete next[day];
      return next;
    });
    onStopRest();
  };

  return (
    <>
      <div className="days" role="group" aria-label="Training day">
        {PROGRAM.map((d) => (
          <button key={d.day} aria-pressed={d.day === day} onClick={() => onDay(d.day)}>
            {d.day === state.nextDay && <i className="next-dot" title="Up next" />}
            <b>Day {d.day}</b>
            <span>{d.title.split(" ")[0]}, {d.focus.toLowerCase()}</span>
          </button>
        ))}
      </div>
      <div className="dayhead">
        <h2>{program.title} ({program.focus.toLowerCase()})</h2>
        <p>
          {day === state.nextDay ? "Up next in your rotation." : `Day ${state.nextDay} is next in your rotation.`}{" "}
          Stop each first set with about 2 reps left in the tank.
        </p>
      </div>

      {program.slots.map((slot) => (
        <ExerciseCard
          key={slot.id}
          snap={snap}
          slot={slot}
          ex={draft.ex[slot.id]}
          onEdit={(fn) => editExercise(slot.id, fn)}
          onRest={onRest}
        />
      ))}

      <div className="actions">
        <button className="primary" onClick={finish}>Finish workout</button>
        {error && <p className="err">{error}</p>}
        <button className="ghost" onClick={discard}>Discard this workout</button>
      </div>
    </>
  );
}

const TickIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
);

function ExerciseCard({ snap, slot, ex, onEdit, onRest }: {
  snap: Snapshot;
  slot: Slot;
  ex: DraftExercise;
  onEdit: (fn: (ex: DraftExercise) => DraftExercise) => void;
  onRest: (seconds: number, label: string) => void;
}) {
  const { state } = snap;
  const u = state.units;
  const st = slotStateOf(state, slot.id);
  const plan = planFor(state, slot);
  const repsTxt = plan.range ? `${plan.range[0]}–${plan.range[1]}` : slot.reps;

  const setLoad = (i: number, w: string) =>
    onEdit((e) => ({
      ...e,
      // carry the new load down to later sets you haven't finished yet
      sets: e.sets.map((s, j) => (j === i || (j > i && !s.done) ? { ...s, w } : s)),
    }));

  const bumpReps = (i: number, d: number) =>
    onEdit((e) => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, r: Math.max(0, Math.min(99, s.r + d)) } : s)) }));

  const tick = (i: number) => {
    const sets = ex.sets.map((s, j) => (j === i ? { ...s, done: !s.done } : s));
    onEdit((e) => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, done: !s.done } : s)) }));
    if (sets[i].done) {
      const next = sets.findIndex((s) => !s.done);
      onRest(slot.rest, next >= 0 ? `set ${next + 1}` : "your next exercise");
    }
  };

  const why = plan.easing ? "Ease-in week: one set fewer to limit soreness." : st.reason || "Your current working load.";

  return (
    <section className="ex">
      <div className="ex-top">
        <div>
          <select
            className="variant"
            aria-label={`${slot.name} exercise`}
            value={variantOf(state, slot)}
            onChange={(e) => {
              const v = e.target.value;
              store.updateState((s, now) => ({ ...s, variants: { ...s.variants, [slot.id]: v }, settingsAt: now }));
            }}
          >
            {slot.variants.map((v) => <option key={v}>{v}</option>)}
          </select>
          <div className="slotname">{slot.name}</div>
          {st.mode === "adp" && <span className="mode">Rep range</span>}
        </div>
        <div className="rx">
          {ex.sets.length} × {repsTxt}
          <small>rest {Math.round((slot.rest / 60) * 2) / 2} min</small>
        </div>
      </div>

      {st.weight == null ? (
        <div className="suggest new">
          <div className="big">?</div>
          <p className="why">
            First time: pick a load you’re <em>confident</em> you can lift for every set, stopping 2 reps short of failure.
            {slot.bw && " For chin-ups or pull-ups, log added weight (0 for bodyweight)."}
          </p>
        </div>
      ) : (
        <div className={`suggest ${plan.easing ? "new" : st.kind}`}>
          <div className="big">{fmt(st.weight)}<small>{u}</small></div>
          <p className="why">{why}</p>
        </div>
      )}

      <ol className="sets">
        {ex.sets.map((s, i) => (
          <li key={i} className={s.done ? "set done" : "set"}>
            <span className="n">{i + 1}</span>
            <label className="wbox">
              <input
                className="w"
                inputMode="decimal"
                enterKeyHint="done"
                aria-label={`Set ${i + 1} weight`}
                placeholder="Load"
                value={s.w}
                onChange={(e) => setLoad(i, e.target.value)}
              />
              <span>{u}</span>
            </label>
            <div className="reps">
              <button aria-label="One fewer rep" onClick={() => bumpReps(i, -1)}>−</button>
              <output aria-label="Reps">{s.r}</output>
              <button aria-label="One more rep" onClick={() => bumpReps(i, 1)}>+</button>
            </div>
            <button className="tick" aria-pressed={s.done} aria-label={`Mark set ${i + 1} done`} onClick={() => tick(i)}>
              <TickIcon />
            </button>
          </li>
        ))}
      </ol>

      <div className="rir">
        <p>Set 1: how many more reps could you have done?</p>
        <div className="chips">
          {[0, 1, 2, 3, 4].map((v) => (
            <button key={v} aria-pressed={ex.rir === v} onClick={() => onEdit((e) => ({ ...e, rir: e.rir === v ? null : v }))}>
              {v === 4 ? "4+" : v}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
