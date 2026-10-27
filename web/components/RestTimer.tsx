import { useEffect, useRef, useState } from "react";

export interface Timer {
  end: number;
  total: number;
  label: string;
}

// Counts against the wall clock so it stays right when the phone sleeps the tab.
export default function RestTimer({ timer, onAdd, onClose }: { timer: Timer; onAdd: () => void; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const buzzedFor = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.min(timer.total, Math.max(0, timer.end - now));
  const over = left === 0;

  useEffect(() => {
    if (over && buzzedFor.current !== timer.end) {
      buzzedFor.current = timer.end;
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
    }
  }, [over, timer.end]);

  const m = Math.floor(left / 60000), s = Math.ceil((left % 60000) / 1000);
  const disp = over ? "0:00" : s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;

  return (
    <div className={over ? "timer over" : "timer"}>
      <div className="bar" style={{ width: `${100 - (left / timer.total) * 100}%` }} />
      <div className="timer-inner">
        <span className="t" role="timer">{disp}</span>
        <span className="lbl">{over ? "Rest done. Next set." : `Resting before ${timer.label}`}</span>
        {!over && <button onClick={onAdd}>+30 s</button>}
        <button onClick={onClose}>{over ? "Close" : "Skip"}</button>
      </div>
    </div>
  );
}
