import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { deleteFood, describedName, parseISO, RICE_CUP, saveFood, sumFood } from "@/lib/cut";
import { store } from "@/lib/store";
import type { FoodEntry, ISODate, MealItem } from "@/lib/types";
import NumField from "./NumField";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// Entries for a past day keep the current time of day, so they stay in the order logged.
function atFor(date: ISODate) {
  const now = new Date();
  const d = parseISO(date);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return d.getTime();
}

const newId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// One number for the day: morning weight or the step total.
export function ValueSheet({ title, label, value, onSave, onClose }: {
  title: string;
  label: string;
  value: number | undefined;
  onSave: (n: number | null) => void;
  onClose: () => void;
}) {
  const [n, setN] = useState<number | null>(value ?? null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (n == null) return;
    onSave(n);
    onClose();
  };
  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="log">
          <label className="full">{label}<NumField value={n} label={label} onChange={setN} /></label>
        </div>
        <div className="sheet-actions">
          <button className="primary" disabled={n == null}>Save</button>
          {value != null && <button type="button" className="ghost" onClick={() => { onSave(null); onClose(); }}>Clear</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

// Add a food by hand, or edit any entry.
export function FoodSheet({ date, entry, onClose }: { date: ISODate; entry?: FoodEntry; onClose: () => void }) {
  const [name, setName] = useState(entry?.name ?? "");
  const [kcal, setKcal] = useState<number | null>(entry?.kcal ?? null);
  const [protein, setProtein] = useState<number | null>(entry?.proteinG ?? null);
  const [fat, setFat] = useState<number | null>(entry?.fatG ?? null);
  const [carbs, setCarbs] = useState<number | null>(entry?.carbsG ?? null);
  const [fibre, setFibre] = useState<number | null>(entry?.fibreG ?? null);
  const hasMore = entry?.fatG != null || entry?.carbsG != null || entry?.fibreG != null;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (kcal == null) return;
    store.updateState((s, now) =>
      saveFood(s, {
        ...(entry ?? { id: newId(), date, at: atFor(date), source: "manual" as const }),
        name: name.trim() || "Food",
        kcal,
        proteinG: protein ?? 0,
        fatG: fat ?? undefined,
        carbsG: carbs ?? undefined,
        fibreG: fibre ?? undefined,
      }, now));
    onClose();
  };

  const addRice = () => {
    store.updateState((s, now) => saveFood(s, { id: newId(), date, at: atFor(date), source: "manual", ...RICE_CUP }, now));
    onClose();
  };

  const num = (label: string, v: number | null, set: (n: number | null) => void) => (
    <label>{label}<NumField value={v} label={label} placeholder="–" onChange={set} /></label>
  );

  return (
    <Sheet title={entry ? "Edit food" : "Add food"} onClose={onClose}>
      {!entry && (
        <div className="toggles" style={{ marginTop: 8 }}>
          <button type="button" onClick={addRice}>+ {RICE_CUP.name} ({RICE_CUP.kcal} kcal)</button>
        </div>
      )}
      {entry?.text && <p className="note">You described: “{entry.text}”</p>}
      {entry?.items && (
        <ul className="breakdown">
          {entry.items.map((i, k) => <li key={k}><span>{i.name}<small>{i.portion}</small></span><span>{Math.round(i.kcal)} kcal</span></li>)}
        </ul>
      )}
      <form onSubmit={save}>
        <div className="log" style={{ marginTop: 10 }}>
          <label className="full">
            Name (optional)
            <input className="text" value={name} placeholder="What you ate" onChange={(e) => setName(e.target.value)} />
          </label>
          {num("Calories", kcal, setKcal)}
          {num("Protein (g)", protein, setProtein)}
        </div>
        <details open={hasMore}>
          <summary>More: fat, carbs, fibre</summary>
          <div className="log" style={{ marginTop: 8 }}>
            {num("Fat (g)", fat, setFat)}
            {num("Carbs (g)", carbs, setCarbs)}
            {num("Fibre (g)", fibre, setFibre)}
          </div>
        </details>
        <div className="sheet-actions">
          <button className="primary" disabled={kcal == null}>{entry ? "Save" : "Add"}</button>
          {entry && (
            <button type="button" className="ghost danger-text" onClick={() => { store.updateState((s, now) => deleteFood(s, entry.id, now)); onClose(); }}>
              Delete
            </button>
          )}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

function errorText(e: unknown) {
  if (!(e instanceof ApiError)) return "Can’t reach the server. Add it manually for now.";
  if (e.status === 401) return "Sign in to use meal estimates.";
  const msg = (e.body as { error?: string } | null)?.error;
  return msg ? msg[0].toUpperCase() + msg.slice(1) + "." : "Couldn’t estimate that. Try again.";
}

// Describe a meal, review Claude's estimate, then add it as one entry.
export function DescribeSheet({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ items: MealItem[]; note: string } | null>(null);

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

  const add = () => {
    if (!draft?.items.length) return;
    const items = draft.items;
    store.updateState((s, now) =>
      saveFood(s, { id: newId(), date, at: atFor(date), source: "described", name: describedName(items, text), text, items, ...sumFood(items) }, now));
    onClose();
  };

  const editItem = (i: number, patch: Partial<MealItem>) =>
    draft && setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const total = draft && sumFood(draft.items);

  return (
    <Sheet title="Describe a meal" onClose={onClose}>
      {!draft ? (
        <>
          <p className="note">Say what and how much, e.g. “1 cup rice, chicken adobo thigh, 1 boiled egg”. Portions make the biggest difference.</p>
          <div className="log" style={{ marginTop: 10 }}>
            <label className="full">
              What you ate
              <textarea value={text} maxLength={1000} autoFocus onChange={(e) => setText(e.target.value)} />
            </label>
          </div>
          {error && <p className="err">{error}</p>}
          <div className="sheet-actions">
            <button className="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? "Estimating…" : "Estimate"}</button>
            <button className="ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {draft.items.length === 0 && <p className="note">No foods found.</p>}
          {draft.items.map((it, i) => (
            <div className="meal-item" key={i}>
              <div className="meal-name"><b>{it.name}</b><span>{it.portion}</span></div>
              <label>kcal<NumField value={it.kcal} label={`${it.name} kcal`} onChange={(n) => editItem(i, { kcal: n ?? 0 })} /></label>
              <label>protein<NumField value={it.proteinG} label={`${it.name} protein`} onChange={(n) => editItem(i, { proteinG: n ?? 0 })} /></label>
              <button aria-label={`Remove ${it.name}`} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          {draft.note && <p className="note">{draft.note}</p>}
          {total && <p className="meal-total">{total.kcal.toLocaleString()} kcal · {total.proteinG} g protein · {total.fatG} g fat · {total.carbsG} g carbs</p>}
          <div className="sheet-actions">
            <button className="primary" disabled={!draft.items.length} onClick={add}>Add to log</button>
            <button className="ghost" onClick={() => setDraft(null)}>Back</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
