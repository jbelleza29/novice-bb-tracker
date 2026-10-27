import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DayLog, ISODate, Meal, MealItem } from "@/lib/types";
import NumField from "./NumField";

const MACROS = ["kcal", "proteinG", "fatG", "carbsG", "fibreG"] as const;

const sum = (items: MealItem[]) =>
  Object.fromEntries(MACROS.map((k) => [k, Math.round(items.reduce((a, i) => a + i[k], 0))])) as Record<(typeof MACROS)[number], number>;

function errorText(e: unknown) {
  if (!(e instanceof ApiError)) return "Can’t reach the server. Enter the numbers by hand for now.";
  if (e.status === 401) return "Sign in to use meal estimates.";
  const msg = (e.body as { error?: string } | null)?.error;
  return msg ? msg[0].toUpperCase() + msg.slice(1) + "." : "Couldn’t estimate that. Try again.";
}

// Describe a meal, review Claude's estimate, then add its totals to the day.
export default function MealEstimate({ date, log, onUpdate }: {
  date: ISODate;
  log: DayLog | undefined;
  onUpdate: (date: ISODate, patch: Partial<DayLog>) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ items: MealItem[]; note: string } | null>(null);
  const meals = log?.meals ?? [];

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setDraft(await api.estimate(text));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Totals live on the day fields, so adding and removing a meal shifts them by its sum.
  const shift = (items: MealItem[], sign: 1 | -1, nextMeals: Meal[]) => {
    const t = sum(items);
    const patch: Partial<DayLog> = { meals: nextMeals };
    for (const k of MACROS) patch[k] = Math.max(0, (log?.[k] ?? 0) + sign * t[k]);
    onUpdate(date, patch);
  };

  const add = () => {
    if (!draft) return;
    shift(draft.items, 1, [...meals, { id: "m" + Date.now(), text, items: draft.items, at: Date.now() }]);
    setDraft(null);
    setText("");
  };

  const editItem = (i: number, patch: Partial<MealItem>) =>
    draft && setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  const total = draft && sum(draft.items);

  return (
    <div className="card">
      <h3>Describe a meal</h3>
      <p>Say what and how much, e.g. “1 cup rice, chicken adobo thigh, 1 boiled egg”. Portions make the biggest difference.</p>
      {!draft ? (
        <>
          <div className="log">
            <label className="full">
              What you ate
              <textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
            </label>
          </div>
          {error && <p className="err">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }} disabled={busy || !text.trim()} onClick={run}>
            {busy ? "Estimating…" : "Estimate"}
          </button>
        </>
      ) : (
        <>
          {draft.items.length === 0 && <p className="note">No foods found.</p>}
          {draft.items.map((it, i) => (
            <div className="meal-item" key={i}>
              <div className="meal-name">
                <b>{it.name}</b>
                <span>{it.portion}</span>
              </div>
              <label>kcal<NumField value={it.kcal} label={`${it.name} kcal`} onChange={(n) => editItem(i, { kcal: n ?? 0 })} /></label>
              <label>protein<NumField value={it.proteinG} label={`${it.name} protein`} onChange={(n) => editItem(i, { proteinG: n ?? 0 })} /></label>
              <button aria-label={`Remove ${it.name}`} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          {draft.note && <p className="note">{draft.note}</p>}
          {total && (
            <p className="meal-total">
              {total.kcal.toLocaleString()} kcal · {total.proteinG} g protein · {total.fatG} g fat · {total.carbsG} g carbs · {total.fibreG} g fibre
            </p>
          )}
          <div className="decision" style={{ background: "none", border: 0, padding: 0 }}>
            <div className="btns">
              <button disabled={!draft.items.length} onClick={add}>Add to log</button>
              <button onClick={() => setDraft(null)}>Back</button>
            </div>
          </div>
        </>
      )}

      {meals.length > 0 && (
        <ul className="meals">
          {meals.map((m) => {
            const t = sum(m.items);
            return (
              <li key={m.id}>
                <span>{m.text}<small>{t.kcal.toLocaleString()} kcal · {t.proteinG} g protein</small></span>
                <button aria-label="Remove meal" onClick={() => shift(m.items, -1, meals.filter((x) => x.id !== m.id))}>×</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
