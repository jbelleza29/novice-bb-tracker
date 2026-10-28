import { useEffect, useState } from "react";
import { api, ApiError, type Insight, type InsightReply } from "@/lib/api";

const modelName = (id: string) =>
  id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^\w/, (c) => c.toUpperCase());
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const when = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? clock(ms) : d.toLocaleDateString(undefined, { weekday: "short" }) + " " + clock(ms);
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// AI insight that only runs when tapped. The server enforces the cooldown; this just reflects it.
export default function InsightBox({ kind, period, summary }: { kind: "daily" | "weekly"; period: string; summary: string }) {
  const [reply, setReply] = useState<InsightReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    api.getInsight(kind, period).then((r) => live && setReply(r)).catch(() => live && setReply({ insight: null, enabled: true }));
    return () => { live = false; };
  }, [kind, period]);
  useEffect(() => { sha256(summary).then(setHash).catch(() => {}); }, [summary]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  if (!reply) return null;
  if (!reply.enabled) return <p className="note">AI insights aren’t set up on this server.</p>;

  const ins: Insight | null = reply.insight;
  const cooling = !!ins && now < ins.nextAt;
  const stale = !!ins && !!hash && ins.summaryHash !== hash;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setReply(await api.requestInsight(kind, period, summary));
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; insight?: Insight } | null) : null;
      if (body?.insight) setReply({ insight: body.insight, enabled: true });
      setError(e instanceof ApiError ? (body?.error ? body.error[0].toUpperCase() + body.error.slice(1) + "." : "Couldn’t get an insight. Try again.")
        : "Can’t reach the server.");
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  };

  return (
    <div className="insight">
      {ins && (
        <>
          <ul>{ins.text.split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="insight-meta">
            {modelName(ins.model)} · {when(ins.createdAt)}
            {stale && " · you’ve logged more since"}
          </p>
        </>
      )}
      {error && <p className="err" style={{ textAlign: "left" }}>{error}</p>}
      {cooling ? (
        <p className="insight-meta">Next {kind} insight after {when(ins!.nextAt)}.</p>
      ) : (
        <button className="btn" disabled={busy} onClick={run}>
          {busy ? "Thinking…" : ins ? (stale ? "Refresh with new entries" : "Refresh insight") : kind === "daily" ? "Get day insight" : "Get week insight"}
        </button>
      )}
    </div>
  );
}
