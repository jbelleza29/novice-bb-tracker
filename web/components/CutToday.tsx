import { addDays, dayChecks, liftDates, parseISO, RICE_CUP, todayISO } from "@/lib/cut";
import { store, type Snapshot } from "@/lib/store";
import type { CutSettings, DayLog, ISODate } from "@/lib/types";
import NumField from "./NumField";

type NumKey = "weightKg" | "kcal" | "proteinG" | "fatG" | "carbsG" | "fibreG" | "steps" | "sleepHours";

export const updateDay = (date: ISODate, patch: Partial<DayLog>) =>
  store.updateState((s, now) => ({ ...s, days: { ...s.days, [date]: { ...s.days[date], ...patch, updatedAt: now } } }));

export default function CutToday({ snap, cut, date, onDate }: {
  snap: Snapshot;
  cut: CutSettings;
  date: ISODate;
  onDate: (d: ISODate) => void;
}) {
  const today = todayISO();
  const log = snap.state.days[date];
  const t = cut.targets;
  const workout = liftDates(snap.sessions).has(date);
  const c = dayChecks(t, log, workout);
  const label = date === today ? "Today" : date === addDays(today, -1) ? "Yesterday"
    : parseISO(date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  const field = (k: NumKey, title: string, cls = "") => (
    <label className={cls}>
      {title}
      <NumField value={log?.[k]} label={title} placeholder="–" onChange={(n) => updateDay(date, { [k]: n ?? undefined })} />
    </label>
  );
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
  // Today isn't over: falling short so far is pending, only going over calories is a miss.
  const pending = date === today && {
    kcal: (log?.kcal ?? 0) < t.kcal - 100,
    protein: true,
    steps: true,
  };
  const mark = (v: boolean | null, k?: "kcal" | "protein" | "steps") =>
    v == null ? "–" : v ? "✓" : pending && k && pending[k] ? "…" : "✗";
  const cls = (v: boolean | null, k?: "kcal" | "protein" | "steps") =>
    v == null ? "" : v ? "yes" : pending && k && pending[k] ? "" : "no";

  return (
    <>
      <div className="datebar">
        <button aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}>‹</button>
        <h2>{label}</h2>
        <button aria-label="Next day" disabled={date >= today} onClick={() => onDate(addDays(date, 1))}>›</button>
      </div>

      <div className="remain">
        <div><b>{(t.kcal - (log?.kcal ?? 0)).toLocaleString()}</b><span>kcal left of {t.kcal.toLocaleString()}</span></div>
        <div><b>{Math.max(0, t.proteinG - (log?.proteinG ?? 0))} g</b><span>protein to go of {t.proteinG} g</span></div>
      </div>

      <div className="card">
        <div className="log">
          {field("weightKg", "Morning weight (kg)", "full")}
          {field("kcal", "Calories")}
          {field("proteinG", "Protein (g)")}
          {field("steps", "Steps", "full")}
        </div>
        <div className="toggles">
          <button onClick={() => updateDay(date, { kcal: (log?.kcal ?? 0) + RICE_CUP.kcal, carbsG: (log?.carbsG ?? 0) + RICE_CUP.carbsG })}>
            + 1 cup rice ({RICE_CUP.kcal} kcal)
          </button>
          {workout ? (
            <button aria-pressed="true" disabled>Lifted (workout logged)</button>
          ) : (
            <button aria-pressed={!!log?.lifted} onClick={() => updateDay(date, { lifted: !log?.lifted })}>Lifted</button>
          )}
        </div>
        {scale("hunger", "Hunger (5 = very hungry)")}
        {scale("workFocus", "Work focus (5 = sharp)")}

        <details>
          <summary>More: macros, sleep, notes</summary>
          <div className="log" style={{ marginTop: 10 }}>
            {field("fatG", "Fat (g)")}
            {field("carbsG", "Carbs (g)")}
            {field("fibreG", "Fibre (g)")}
            {field("sleepHours", "Sleep (h)")}
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

      <div className="card">
        <h3>{label === "Today" ? "Today so far" : label}</h3>
        <div className="checks">
          <div className={cls(c.kcal, "kcal")}><b>{mark(c.kcal, "kcal")}</b>kcal ±100</div>
          <div className={cls(c.protein, "protein")}><b>{mark(c.protein, "protein")}</b>protein</div>
          <div className={cls(c.steps, "steps")}><b>{mark(c.steps, "steps")}</b>{(t.stepsFloor / 1000).toLocaleString()}k steps</div>
          <div className={c.lifted ? "yes" : ""}><b>{c.lifted ? "✓" : "–"}</b>lifted</div>
        </div>
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
    </>
  );
}
