import { useState } from "react";
import { addDays, applyDecision, checkpoint, checkpointInput, liftDates, mondayOf, parseISO, tdee, todayISO, weekSummary } from "@/lib/cut";
import { store, type Snapshot } from "@/lib/store";
import type { CheckIn, CutSettings, Decision, ISODate } from "@/lib/types";
import { weekSummaryForAI } from "@/lib/recap";
import InsightBox from "./InsightBox";
import NumField from "./NumField";

const short = (d: ISODate) => parseISO(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function describe(d: Decision) {
  if (d.action === "increase") return `Add ${d.kcalDelta} kcal a day`;
  if (d.action === "decrease") return d.lever === "kcal" ? `Cut ${d.amount} kcal a day` : `Add ${d.amount.toLocaleString()} steps a day`;
  return "Keep targets as they are";
}

export default function CutWeek({ snap, cut }: { snap: Snapshot; cut: CutSettings }) {
  const today = todayISO();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const { days, checkins } = snap.state;
  const s = weekSummary(cut, snap.state, liftDates(snap.sessions), monday, today);
  const checkin = checkins[monday];
  const inCut = monday >= mondayOf(cut.startDate) && monday <= today;
  const input = checkpointInput(days, monday);
  const proposed = checkpoint(cut, monday, input);
  const decided = checkin?.decision ?? null;
  const prevWaist = Object.values(checkins).filter((c) => c.weekStart < monday && c.waistCm != null).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];

  const blank: CheckIn = { weekStart: monday, avgWeightKg: input.thisWeekKg, decision: null, updatedAt: 0 };
  const saveCheckin = (patch: Partial<CheckIn>) =>
    store.updateState((st, now) => ({
      ...st,
      checkins: { ...st.checkins, [monday]: { ...(st.checkins[monday] ?? blank), ...patch, updatedAt: now } },
    }));

  // One adjustment per week: the decision is recorded with the check-in and the buttons go away.
  const decide = (d: Decision, apply: boolean) =>
    store.updateState((st, now) => ({
      ...st,
      cut: apply && st.cut ? { ...st.cut, targets: applyDecision(st.cut.targets, d) } : st.cut,
      cutAt: apply ? now : st.cutAt,
      checkins: { ...st.checkins, [monday]: { ...(st.checkins[monday] ?? blank), avgWeightKg: input.thisWeekKg, decision: d, updatedAt: now } },
    }));

  const pct = s.adherence == null ? "–" : Math.round(s.adherence * 100) + "%";
  const fmtN = (n: number | null, unit = "") => (n == null ? "–" : n.toLocaleString() + unit);

  return (
    <>
      <div className="datebar">
        <button aria-label="Previous week" onClick={() => setMonday(addDays(monday, -7))}>‹</button>
        <h2>Week of {short(monday)}</h2>
        <button aria-label="Next week" disabled={addDays(monday, 7) > today} onClick={() => setMonday(addDays(monday, 7))}>›</button>
      </div>

      <div className="card">
        <h3>Adherence {pct}</h3>
        <p>Calories within 100, protein met and steps over the floor, each day so far. Days not logged count as misses.</p>
        <div className="stats">
          <div><b>{fmtN(s.avgKcal)}</b><span>avg kcal (target {cut.targets.kcal.toLocaleString()})</span></div>
          <div><b>{fmtN(s.avgProtein, " g")}</b><span>avg protein (target {cut.targets.proteinG} g)</span></div>
          <div><b>{fmtN(s.avgSteps)}</b><span>avg steps (goal {cut.targets.stepsGoal.toLocaleString()})</span></div>
          <div><b>{s.lifts} / {cut.targets.liftsPerWeek}</b><span>lifting sessions</span></div>
        </div>
      </div>

      {inCut && (
        <div className="card">
          <h3>Week insight</h3>
          <p>Patterns across the days so far, written by Claude when you ask.</p>
          <InsightBox kind="weekly" period={monday} summary={weekSummaryForAI(snap.state, snap.sessions, monday, today)} />
        </div>
      )}

      {inCut && (
        <div className="card">
          <h3>Monday check-in</h3>
          <p>
            7-day average: {input.thisWeekKg == null ? "not enough weigh-ins" : input.thisWeekKg + " kg"}
            {input.lastWeekKg != null && input.thisWeekKg != null && ` (${(input.thisWeekKg - input.lastWeekKg).toFixed(1)} kg vs last week)`}.
            {input.thisWeekKg != null && ` Estimated burn about ${(Math.round(tdee(cut, input.thisWeekKg) / 10) * 10).toLocaleString()} kcal a day.`}
          </p>
          <div className="log">
            <label className="full">
              Waist at navel (cm)
              <NumField value={checkin?.waistCm} label="Waist" placeholder="–" onChange={(n) => saveCheckin({ waistCm: n ?? undefined })} />
              {prevWaist && <div className="hint">Last: {prevWaist.waistCm} cm on {short(prevWaist.weekStart)}</div>}
            </label>
          </div>

          {decided ? (
            <div className={`decision ${decided.action}`}>
              <b>Done for this week: {describe(decided)}</b>
              <p>{decided.reason}</p>
            </div>
          ) : (
            <div className={`decision ${proposed.action}`}>
              <b>Suggested: {describe(proposed)}</b>
              <p>{proposed.reason}</p>
              <div className="btns">
                <button onClick={() => decide(proposed, true)}>{proposed.action === "hold" ? "OK" : "Apply"}</button>
                {proposed.action !== "hold" && (
                  <button onClick={() => decide({ action: "hold", reason: "You chose to keep your targets this week." }, false)}>Keep targets</button>
                )}
              </div>
            </div>
          )}
          <p className="note">Photos: take front, side and back shots in the same light each Monday. Photo storage isn’t in the app yet.</p>
        </div>
      )}
    </>
  );
}
