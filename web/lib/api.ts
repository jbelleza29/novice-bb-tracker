import type { AppState, MealItem, Session } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super("API " + status);
  }
}

export interface RemoteState {
  state: AppState | null;
  version: number;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text && res.headers.get("Content-Type")?.includes("application/json") ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  login: (passcode: string) => call<null>("POST", "/login", { passcode }),
  logout: () => call<null>("POST", "/logout"),
  getState: () => call<RemoteState>("GET", "/state"),
  putState: (state: AppState, baseVersion: number) => call<{ version: number }>("PUT", "/state", { state, baseVersion }),
  getSessions: () => call<{ sessions: Session[] }>("GET", "/sessions").then((r) => r.sessions),
  putSession: (s: Session) => call<null>("PUT", "/sessions/" + encodeURIComponent(s.id), s),
  deleteSessionsBefore: (iso: string) => call<null>("DELETE", "/sessions?before=" + encodeURIComponent(iso)),
  estimate: (text: string) => call<{ items: MealItem[]; note: string }>("POST", "/estimate", { text }),
};
