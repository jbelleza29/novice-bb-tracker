import { fmt } from "@/lib/engine";
import { PROGRAM } from "@/lib/program";
import type { Session } from "@/lib/types";

// Weekly reactive-deload check-in (from the Ripped Body progression guide)
const QUESTIONS = [
  "Are you dreading the gym?",
  "Is sleep worse than normal?",
  "Are loads or reps flat or dropping?",
  "Is stress worse than normal?",
  "Are aches and pains worse than normal?",
];

export default function HistoryView({ sessions, checkin, onCheckin }: {
  sessions: Session[];
  checkin: Record<number, boolean>;
  onCheckin: (c: Record<number, boolean>) => void;
}) {
  const yes = Object.values(checkin).filter(Boolean).length;
  const answered = Object.keys(checkin).length;

  return (
    <>
      <div className="card">
        <h3>Weekly check-in</h3>
        <p>After a week of training and rest days, answer honestly.</p>
        {QUESTIONS.map((q, i) => (
          <div className="q" key={i}>
            <span>{q}</span>
            <div className="yn">
              <button aria-pressed={checkin[i] === true} onClick={() => onCheckin({ ...checkin, [i]: true })}>Yes</button>
              <button aria-pressed={checkin[i] === false} onClick={() => onCheckin({ ...checkin, [i]: false })}>No</button>
            </div>
          </div>
        ))}
        {answered === QUESTIONS.length && (
          <div className="verdict">
            {yes >= 2 ? (
              <><b>Consider a deload week.</b> Keep the same days, loads and effort, but cut sets by about a third to a half on every exercise. If only one area aches, cut sets just for the exercises that load it.</>
            ) : (
              <><b>Carry on.</b> Recovery looks fine, so train as planned.</>
            )}
          </div>
        )}
      </div>

      {!sessions.length && (
        <div className="empty">
          <b>No workouts logged yet</b>
          Finish your first session and it shows up here with what changes next time.
        </div>
      )}

      {sessions.map((s) => {
        const d = PROGRAM[s.day - 1];
        const date = new Date(s.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
        return (
          <article className="hist" key={s.id}>
            <h3>Day {s.day}: {d.title} ({d.focus.toLowerCase()})</h3>
            <div className="date">{date}</div>
            <table>
              <tbody>
                {s.ex.map((e) => (
                  <tr key={e.slot}>
                    <td>{e.name}</td>
                    <td>{[...new Set(e.sets.map((x) => fmt(x.w)))].join("/")} {s.units} × {e.sets.map((x) => x.r).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        );
      })}
    </>
  );
}
