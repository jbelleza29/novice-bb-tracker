import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { deleteFood, describedName, parseISO, RICE_CUP, saveFood, sumFood } from "@/lib/cut";
import { setWatching, startEstimate } from "@/lib/estimates";
import { store, useTracker } from "@/lib/store";
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
        edited: entry?.edited || (!!entry && (kcal !== entry.kcal || (protein ?? 0) !== entry.proteinG || (fat ?? undefined) !== entry.fatG
          || (carbs ?? undefined) !== entry.carbsG || (fibre ?? undefined) !== entry.fibreG)) || undefined,
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
      {entry?.note && <p className="note">{entry.note}</p>}
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

const shortName = (text: string) => (text.length > 48 ? text.slice(0, 45).trimEnd() + "…" : text);

// Describe a meal. Claude's estimate goes straight into the log; fixing it is optional.
export function DescribeSheet({ date, entry, onClose }: { date: ISODate; entry?: FoodEntry; onClose: () => void }) {
  const snap = useTracker();
  const [text, setText] = useState(entry?.text ?? "");
  const [id, setId] = useState<string | null>(entry?.id ?? null);
  const e = id ? snap?.state.food[id] : undefined;

  useEffect(() => {
    setWatching(id);
    return () => setWatching(null);
  }, [id]);

  const run = (desc: string, at = atFor(date)) => {
    const pending: FoodEntry = { id: newId(), date, at, source: "described", name: shortName(desc), text: desc, kcal: 0, proteinG: 0, estimate: "pending", updatedAt: 0 };
    store.updateState((s, now) => saveFood(id ? deleteFood(s, id, now) : s, pending, now));
    setId(pending.id);
    void startEstimate(pending);
  };
  const remove = () => {
    if (id) store.updateState((s, now) => deleteFood(s, id, now));
    onClose();
  };
  const setItems = (items: MealItem[]) =>
    e && store.updateState((s, now) => saveFood(s, { ...e, items, name: describedName(items, e.text ?? ""), ...sumFood(items), edited: true }, now));

  if (!e || e.deleted) {
    return (
      <Sheet title="Describe a meal" onClose={onClose}>
        <p className="note">Say what and how much, e.g. “1 cup rice, chicken adobo thigh, 1 boiled egg”. Portions make the biggest difference.</p>
        <div className="log" style={{ marginTop: 10 }}>
          <label className="full">
            What you ate
            <textarea value={text} maxLength={1000} autoFocus onChange={(ev) => setText(ev.target.value)} />
          </label>
        </div>
        <div className="sheet-actions">
          <button className="primary" disabled={!text.trim()} onClick={() => run(text.trim())}>Estimate</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </Sheet>
    );
  }

  if (e.estimate === "pending") {
    return (
      <Sheet title="Describe a meal" onClose={onClose}>
        <p className="note">“{e.text}”</p>
        <p className="estimating"><span className="spin" aria-hidden="true" />Estimating… usually 5–10 s</p>
        <p className="note">It’s added to your log when it’s ready, so you can close this.</p>
        <div className="sheet-actions">
          <button className="primary" onClick={onClose}>Run in background</button>
          <button className="ghost" onClick={remove}>Cancel estimate</button>
        </div>
      </Sheet>
    );
  }

  if (e.estimate === "failed") {
    return (
      <Sheet title="Describe a meal" onClose={onClose}>
        <p className="note">“{e.text}”</p>
        <p className="err">{e.error}</p>
        <div className="sheet-actions">
          <button className="primary" onClick={() => run(e.text ?? "", e.at)}>Try again</button>
          <button className="ghost" onClick={() => { store.updateState((s, now) => deleteFood(s, e.id, now)); setText(e.text ?? ""); setId(null); }}>Edit description</button>
          <button className="ghost danger-text" onClick={remove}>Delete</button>
        </div>
      </Sheet>
    );
  }

  const items = e.items ?? [];
  const editItem = (i: number, patch: Partial<MealItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <Sheet title="Describe a meal" onClose={onClose}>
      <p className="note">Added to your log. Change anything that looks off, or leave it.</p>
      {items.map((it, i) => (
        <div className="meal-item" key={i}>
          <div className="meal-name"><b>{it.name}</b><span>{it.portion}</span></div>
          <label>kcal<NumField value={it.kcal} label={`${it.name} kcal`} onChange={(n) => editItem(i, { kcal: n ?? 0 })} /></label>
          <label>protein<NumField value={it.proteinG} label={`${it.name} protein`} onChange={(n) => editItem(i, { proteinG: n ?? 0 })} /></label>
          <button aria-label={`Remove ${it.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {e.note && <p className="note">{e.note}</p>}
      <p className="meal-total">{e.kcal.toLocaleString()} kcal · {e.proteinG} g protein · {e.fatG ?? 0} g fat · {e.carbsG ?? 0} g carbs</p>
      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>Done</button>
        <button className="ghost danger-text" onClick={remove}>Remove</button>
      </div>
    </Sheet>
  );
}
