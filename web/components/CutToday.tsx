import { useState } from "react";
import { addDays, dayChecks, dayTotals, foodOn, liftDates, parseISO, todayISO } from "@/lib/cut";
import { fmt } from "@/lib/engine";
import { store, type Snapshot } from "@/lib/store";
import type { CutSettings, DayLog, FoodEntry, ISODate } from "@/lib/types";
import { dayRecap, daySummary } from "@/lib/recap";
import { DescribeSheet, FoodSheet, ValueSheet } from "./CutSheets";
import InsightBox from "./InsightBox";
import NumField from "./NumField";

type Open = null | { kind: "weight" } | { kind: "steps" } | { kind: "describe" } | { kind: "food"; entry?: FoodEntry };

export const updateDay = (date: ISODate, patch: Partial<DayLog>) =>
  store.updateState((s, now) => ({ ...s, days: { ...s.days, [date]: { ...s.days[date], ...patch, updatedAt: now } } }));

const time = (at: number | undefined) => (at == null ? "" : new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));

export default function CutToday({ snap, cut, date, onDate }: {
  snap: Snapshot;
  cut: CutSettings;
  date: ISODate;
  onDate: (d: ISODate) => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const today = todayISO();
  const log = snap.state.days[date];
  const food = foodOn(snap.state.food, date);
  const totals = dayTotals(snap.state.food, date);
  const t = cut.targets;
  const workout = liftDates(snap.sessions).has(date);
  const c = dayChecks(t, totals, log, workout);
  const recap = dayRecap(snap.state, snap.sessions, date);
  const summary = daySummary(snap.state, snap.sessions, date);
  const label = date === today ? "Today" : date === addDays(today, -1) ? "Yesterday"
    : parseISO(date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  // Today isn't over: falling short so far is pending, only going over calories is a miss.
  const pending = date === today && { kcal: (totals?.kcal ?? 0) < t.kcal - 100, protein: true, steps: true };
  const mark = (v: boolean | null, k: "kcal" | "protein" | "steps") =>
    v == null ? "–" : v ? "✓" : pending && pending[k] ? "…" : "✗";
  const cls = (v: boolean | null, k: "kcal" | "protein" | "steps") =>
    v == null ? "" : v ? "yes" : pending && pending[k] ? "" : "no";

  const scale = (k: "hunger" | "workFocus", title: string) => (
    <div className="scale">
      <p>{title}</p>
      <div className="chips">
        {[1, 2, 3, 4, 5].map((v) => (
          <button key={v} aria-pressed={log?.[k] === v} onClick={() => updateDay(date, { [k]: log?.[k] === v ? undefined : v })}>{v}</button>
        ))}
      </div>
    </div>
  );
  const toggle = (k: "lateNight" | "ateOut", title: string) => (
    <button aria-pressed={!!log?.[k]} onClick={() => updateDay(date, { [k]: !log?.[k] })}>{title}</button>
  );

  return (
    <>
      <div className="datebar">
        <button aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}>‹</button>
        <h2>{label}</h2>
        <button aria-label="Next day" disabled={date >= today} onClick={() => onDate(addDays(date, 1))}>›</button>
      </div>

      <div className="remain">
        <div><b>{(t.kcal - (totals?.kcal ?? 0)).toLocaleString()}</b><span>kcal left of {t.kcal.toLocaleString()}</span></div>
        <div><b>{Math.max(0, t.proteinG - (totals?.proteinG ?? 0))} g</b><span>protein to go of {t.proteinG} g</span></div>
      </div>

      <section className="card entry">
        <div>
          <div className="entry-label">Morning weight</div>
          {log?.weightKg != null
            ? <div className="entry-value">{fmt(log.weightKg)} kg <small>{time(log.weighedAt)}</small></div>
            : <div className="entry-empty">Not logged yet</div>}
        </div>
        <button className="btn" onClick={() => setOpen({ kind: "weight" })}>{log?.weightKg != null ? "Edit" : "Log weight"}</button>
      </section>

      <section className="card">
        <div className="entry-head">
          <div className="entry-label">Food</div>
          {totals && <div className="entry-label">{totals.kcal.toLocaleString()} kcal · {totals.proteinG} g protein</div>}
        </div>
        {food.length === 0 && <p className="entry-empty">Nothing logged yet</p>}
        <ul className="food-list">
          {food.map((f) => (
            <li key={f.id}>
              <button onClick={() => setOpen({ kind: "food", entry: f })}>
                <span>{f.name}<small>{time(f.at)} · {f.source === "described" ? "described" : "manual"}</small></span>
                <span className="food-num">{f.kcal.toLocaleString()}<small>{f.proteinG} g</small></span>
              </button>
            </li>
          ))}
        </ul>
        <div className="cta-row">
          <button className="btn" onClick={() => setOpen({ kind: "describe" })}>Describe a meal</button>
          <button className="btn" onClick={() => setOpen({ kind: "food" })}>Add manually</button>
        </div>
      </section>

      <section className="card entry">
        <div>
          <div className="entry-label">Steps</div>
          {log?.steps != null
            ? <div className="entry-value">{log.steps.toLocaleString()} <small>{time(log.stepsAt)}</small></div>
            : <div className="entry-empty">Not logged yet</div>}
        </div>
        <button className="btn" onClick={() => setOpen({ kind: "steps" })}>{log?.steps != null ? "Edit" : "Log steps"}</button>
      </section>

      <div className="card">
        <h3>{label === "Today" ? "Day recap so far" : "Day recap"}</h3>
        <div className="checks">
          <div className={cls(c.kcal, "kcal")}><b>{mark(c.kcal, "kcal")}</b>kcal ±100</div>
          <div className={cls(c.protein, "protein")}><b>{mark(c.protein, "protein")}</b>protein</div>
          <div className={cls(c.steps, "steps")}><b>{mark(c.steps, "steps")}</b>{(t.stepsFloor / 1000).toLocaleString()}k steps</div>
          <div className={c.lifted ? "yes" : ""}><b>{c.lifted ? "✓" : "–"}</b>lifted</div>
        </div>
        <ul className="recap">{recap.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <InsightBox kind="daily" period={date} summary={summary} />
      </div>

      <div className="card">
        <h3>Check-in</h3>
        <div className="toggles">
          {workout ? (
            <button aria-pressed="true" disabled>Lifted (workout logged)</button>
          ) : (
            <button aria-pressed={!!log?.lifted} onClick={() => updateDay(date, { lifted: !log?.lifted })}>Lifted</button>
          )}
        </div>
        {scale("hunger", "Hunger (5 = very hungry)")}
        {scale("workFocus", "Work focus (5 = sharp)")}
        <details>
          <summary>More: sleep, notes</summary>
          <div className="log" style={{ marginTop: 10 }}>
            <label>
              Sleep (h)
              <NumField value={log?.sleepHours} label="Sleep (h)" placeholder="–" onChange={(n) => updateDay(date, { sleepHours: n ?? undefined })} />
            </label>
            <label className="full">
              Notes
              <textarea value={log?.notes ?? ""} onChange={(e) => updateDay(date, { notes: e.target.value || undefined })} />
            </label>
          </div>
          <div className="toggles">
            {toggle("lateNight", "Bed after 1 am")}
            {toggle("ateOut", "Ate out")}
          </div>
        </details>
      </div>

      <details className="card tips">
        <summary style={{ marginTop: 0 }}>Food guide</summary>
        <ul>
          <li><b>Rice:</b> 1 cup cooked at lunch, ½–¾ cup at dinner, none at breakfast. Measure it.</li>
          <li><b>Afternoon:</b> one planned snack, e.g. Greek yogurt and berries, a protein shake, or an apple and a boiled egg.</li>
          <li><b>Mains:</b> skinless chicken, fish, shrimp, lean pork or beef, tofu, egg whites. Fried or fatty cuts are occasional.</li>
          <li><b>Every meal:</b> vegetables. Oats, beans and lentils add fibre.</li>
          <li><b>Free:</b> coffee with stevia, diet coke, water. Fast food at most once every 2 weeks, planned.</li>
        </ul>
      </details>

      {open?.kind === "weight" && (
        <ValueSheet title="Morning weight" label="Weight (kg)" value={log?.weightKg} onClose={() => setOpen(null)}
          onSave={(n) => updateDay(date, { weightKg: n ?? undefined, weighedAt: n == null ? undefined : Date.now() })} />
      )}
      {open?.kind === "steps" && (
        <ValueSheet title="Steps" label="Steps today (from Apple Health or Garmin)" value={log?.steps} onClose={() => setOpen(null)}
          onSave={(n) => updateDay(date, { steps: n == null ? undefined : Math.round(n), stepsAt: n == null ? undefined : Date.now() })} />
      )}
      {open?.kind === "food" && <FoodSheet date={date} entry={open.entry} onClose={() => setOpen(null)} />}
      {open?.kind === "describe" && <DescribeSheet date={date} onClose={() => setOpen(null)} />}
    </>
  );
}
