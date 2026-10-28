import { useState } from "react";
import { completeCut, cutDraft, todayISO } from "@/lib/cut";
import { store, type Snapshot } from "@/lib/store";
import type { CutDraft } from "@/lib/types";
import CutForm from "./CutForm";
import CutToday from "./CutToday";
import CutTrend from "./CutTrend";
import CutWeek from "./CutWeek";

type Tab = "today" | "trend" | "week";

export default function CutView({ snap }: { snap: Snapshot }) {
  const [tab, setTab] = useState<Tab>("today");
  const [date, setDate] = useState(todayISO);
  const cut = snap.state.cut;
  if (!cut) return <CutSetup />;

  return (
    <>
      <div className="seg subnav" role="group" aria-label="Cut view">
        {(["today", "trend", "week"] as const).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "today" ? <CutToday snap={snap} cut={cut} date={date} onDate={setDate} />
        : tab === "trend" ? <CutTrend snap={snap} cut={cut} />
        : <CutWeek snap={snap} cut={cut} />}
    </>
  );
}

function CutSetup() {
  const [draft, setDraft] = useState<CutDraft>(() => cutDraft(todayISO()));
  const ready = completeCut(draft);
  return (
    <div className="card">
      <h3>Set up your cut</h3>
      <p>Fill in each number. They drive your targets, chart and weekly check-ins, and you can change them later in Settings.</p>
      <CutForm cut={draft} onChange={(p) => setDraft({ ...draft, ...p })} />
      <button
        className="primary"
        style={{ marginTop: 12 }}
        disabled={!ready}
        onClick={() => ready && store.updateState((s, now) => ({ ...s, cut: ready, cutAt: now }))}
      >
        Start tracking
      </button>
      {!ready && <p className="note">Fill in every field. The goal date must be after the start date.</p>}
    </div>
  );
}
