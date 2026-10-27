export type Units = "kg" | "lb";
export type Mode = "linear" | "adp";
export type Kind = "up" | "hold" | "down" | "switch" | "new";

export interface Slot {
  id: string;
  name: string;
  sets: number;
  reps: number;
  incKg: number;
  incLb: number;
  rest: number;
  variants: string[];
  bw?: boolean;
  day: number;
}

export interface Day {
  day: number;
  title: string;
  focus: string;
  slots: Slot[];
}

export interface SlotState {
  weight: number | null;
  mode: Mode;
  holds: number;
  count: number;
  inc: number | null;
  reason: string;
  kind: Kind;
  units: Units;
  updatedAt: number;
}

// Timestamps drive the sync merge: newest wins per slot and per settings group.
export interface AppState {
  v: 1;
  units: Units;
  easeIn: boolean;
  variants: Record<string, string>;
  settingsAt: number;
  nextDay: number;
  nextDayAt: number;
  slots: Record<string, SlotState>;
  resetAt: number;
}

export interface DraftSet {
  w: string;
  r: number;
  done: boolean;
}

export interface DraftExercise {
  rir: number | null;
  sets: DraftSet[];
}

export interface Draft {
  day: number;
  started: number;
  ex: Record<string, DraftExercise>;
}

export interface LoggedExercise {
  slot: string;
  name: string;
  rir: number;
  sets: { w: number; r: number }[];
  kind: Kind;
  why: string;
}

export interface Session {
  id: string;
  date: string;
  day: number;
  units: Units;
  ex: LoggedExercise[];
}
