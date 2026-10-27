import { useState, type PointerEvent } from "react";
import { addDays, avg7, daysBetween, mondayOf, parseISO, projection, todayISO } from "@/lib/cut";
import type { Snapshot } from "@/lib/store";
import type { CutSettings, ISODate } from "@/lib/types";

const W = 340, H = 220, L = 30, R = 10, T = 10, B = 22;
const short = (d: ISODate) => parseISO(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function CutTrend({ snap, cut }: { snap: Snapshot; cut: CutSettings }) {
  const { days } = snap.state;
  const today = todayISO();
  const [hover, setHover] = useState<ISODate | null>(null);

  const first = [cut.startDate, ...Object.keys(days)].sort()[0];
  const last = [cut.goalDate, today].sort()[1];
  const span = Math.max(1, daysBetween(first, last));
  const dates = Array.from({ length: span + 1 }, (_, i) => addDays(first, i));
  const pts = dates.map((d) => ({ d, w: days[d]?.weightKg ?? null, a: d <= today ? avg7(days, d) : null }));
  const proj = projection(cut, days, today);
  const now = avg7(days, today);

  const vals = [cut.startWeightKg, ...cut.goalBandKg, ...pts.flatMap((p) => [p.w, p.a]), proj?.low, proj?.high].filter((v): v is number => v != null);
  const yMin = Math.floor(Math.min(...vals) - 0.5), yMax = Math.ceil(Math.max(...vals) + 0.5);
  const x = (d: ISODate) => L + (daysBetween(first, d) / span) * (W - L - R);
  const y = (kg: number) => T + ((yMax - kg) / (yMax - yMin)) * (H - T - B);

  const step = yMax - yMin > 12 ? 4 : 2;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);
  const mondays = dates.filter((d) => d === mondayOf(d));
  const every = mondays.length > 6 ? 2 : 1;

  // 7-day average as connected runs, broken where there isn't enough data
  const runs: string[] = [];
  let cur = "";
  for (const p of pts) {
    if (p.a == null) { if (cur) runs.push(cur); cur = ""; continue; }
    cur += `${cur ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.a).toFixed(1)}`;
  }
  if (cur) runs.push(cur);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * span);
    setHover(i >= 0 && i <= span ? dates[i] : null);
  };
  const hp = hover ? pts.find((p) => p.d === hover) : null;

  const vsBand = (lo: number, hi: number) =>
    hi < cut.goalBandKg[0] ? "below your goal band" : lo > cut.goalBandKg[1] ? `${(lo - cut.goalBandKg[1]).toFixed(1)}–${(hi - cut.goalBandKg[1]).toFixed(1)} kg above your goal band` : "inside your goal band";

  return (
    <>
      <div className="card">
        <h3>Weight trend</h3>
        <p>The line is your 7-day average. Single days bounce around, so judge by the line.</p>
        <div className="chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weight chart: daily weigh-ins, 7-day average, goal band and projection"
            onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
            {yTicks.map((v) => (
              <g key={v}>
                <line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
                <text x={L - 5} y={y(v) + 3} textAnchor="end">{v}</text>
              </g>
            ))}
            {mondays.map((d, i) => i % every === 0 && (
              <text key={d} x={x(d)} y={H - 6} textAnchor="middle">{short(d)}</text>
            ))}
            <rect x={L} width={W - L - R} y={y(cut.goalBandKg[1])} height={y(cut.goalBandKg[0]) - y(cut.goalBandKg[1])} fill="var(--green)" opacity={0.14} />
            <line x1={L} x2={W - R} y1={y(cut.goalWeightKg)} y2={y(cut.goalWeightKg)} stroke="var(--green)" strokeWidth={1.5} strokeDasharray="4 3" />
            <line x1={x(cut.goalDate)} x2={x(cut.goalDate)} y1={T} y2={H - B} stroke="var(--line)" strokeWidth={1} />
            {proj && now != null && (
              <>
                <polygon points={`${x(today)},${y(now)} ${x(cut.goalDate)},${y(proj.high)} ${x(cut.goalDate)},${y(proj.low)}`} fill="var(--blue)" opacity={0.15} />
                <line x1={x(today)} y1={y(now)} x2={x(cut.goalDate)} y2={y((proj.low + proj.high) / 2)} stroke="var(--blue)" strokeWidth={1.5} strokeDasharray="4 3" />
              </>
            )}
            {pts.map((p) => p.w != null && <circle key={p.d} cx={x(p.d)} cy={y(p.w)} r={2.5} fill="var(--muted)" opacity={0.5} />)}
            {runs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {hp && (
              <>
                <line x1={x(hp.d)} x2={x(hp.d)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth={1} />
                {hp.a != null && <circle cx={x(hp.d)} cy={y(hp.a)} r={4} fill="var(--blue)" stroke="var(--surface)" strokeWidth={2} />}
              </>
            )}
          </svg>
          {hp && (
            <div className="tip" style={{ left: `${Math.min(80, Math.max(20, (x(hp.d) / W) * 100))}%` }}>
              <b>{short(hp.d)}</b><br />
              Weighed: {hp.w == null ? "–" : hp.w + " kg"}<br />
              7-day avg: {hp.a == null ? "–" : hp.a + " kg"}
            </div>
          )}
        </div>
        <div className="key">
          <span><i style={{ width: 6, height: 6, borderRadius: 3, background: "var(--muted)", opacity: 0.6 }} />Daily weigh-in</span>
          <span><i style={{ width: 14, height: 2, background: "var(--blue)" }} />7-day average</span>
          <span><i style={{ width: 12, height: 10, background: "var(--green)", opacity: 0.25 }} />Goal {cut.goalBandKg[0]}–{cut.goalBandKg[1]} kg</span>
          <span><i style={{ width: 12, height: 10, background: "var(--blue)", opacity: 0.25 }} />Projection</span>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div><b>{now == null ? "–" : now + " kg"}</b><span>7-day average{now == null ? " (needs 4 weigh-ins)" : ""}</span></div>
        <div><b>{now == null ? "–" : (now > cut.startWeightKg ? "+" : "") + (now - cut.startWeightKg).toFixed(1) + " kg"}</b><span>since start ({cut.startWeightKg} kg)</span></div>
        <div><b>{proj ? (proj.ratePerWeek > 0 ? "+" : "") + proj.ratePerWeek + " kg" : "–"}</b><span>per week, last 2–3 weeks</span></div>
        <div>
          <b>{proj ? `${proj.low.toFixed(1)}–${proj.high.toFixed(1)}` : "–"}</b>
          <span>{proj ? `kg by ${short(cut.goalDate)}, ${vsBand(proj.low, proj.high)}` : "projection needs 2 weeks of weigh-ins"}</span>
        </div>
      </div>

      <details className="card">
        <summary style={{ marginTop: 0 }}>Show as table</summary>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Weighed</th><th>7-day avg</th></tr></thead>
          <tbody>
            {pts.filter((p) => p.d <= today && (p.w != null || p.a != null)).reverse().map((p) => (
              <tr key={p.d}><td>{short(p.d)}</td><td>{p.w ?? "–"}</td><td>{p.a ?? "–"}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
