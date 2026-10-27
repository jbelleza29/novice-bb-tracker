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
  cut: CutSettings | null; // null until the cut setup form is filled in
  cutAt: number;
  days: Record<ISODate, DayLog>;
  food: Record<string, FoodEntry>;
  checkins: Record<ISODate, CheckIn>;
}

export type ISODate = string; // local calendar date, "2026-10-27"

export interface CutTargets {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fibreG: number;
  stepsFloor: number;
  stepsGoal: number;
  liftsPerWeek: number;
}

// Weight-loss phase. Always metric.
export interface CutSettings {
  heightCm: number;
  age: number;
  sex: "male" | "female";
  activityFactor: number;
  startDate: ISODate;
  goalDate: ISODate;
  startWeightKg: number;
  goalWeightKg: number;
  goalBandKg: [number, number];
  targets: CutTargets;
}

export interface DayLog {
  weightKg?: number;
  weighedAt?: number;
  steps?: number; // day total from Apple Health or Garmin
  stepsAt?: number;
  lifted?: boolean; // manual tick; logged workouts count automatically
  sleepHours?: number;
  lateNight?: boolean;
  hunger?: number; // 1–5, 5 = very hungry
  workFocus?: number; // 1–5, 5 = sharp
  ateOut?: boolean;
  notes?: string;
  updatedAt: number;
}

// Food logged before entries existed; moved into FoodEntry on load.
export interface LegacyDayLog extends DayLog {
  kcal?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fibreG?: number;
  meals?: Meal[];
}

// One thing eaten. Kept apart from DayLog so entries sync one by one.
export interface FoodEntry {
  id: string;
  date: ISODate;
  at: number;
  name: string;
  source: "described" | "manual";
  kcal: number;
  proteinG: number;
  fatG?: number;
  carbsG?: number;
  fibreG?: number;
  text?: string; // what was typed for a described meal
  items?: MealItem[]; // Claude's breakdown for a described meal
  deleted?: boolean; // kept so the delete wins over older copies on other devices
  updatedAt: number;
}

export interface MealItem {
  name: string;
  portion: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fibreG: number;
}

export interface Meal {
  id: string;
  text: string;
  items: MealItem[];
  at: number;
}

export type Decision =
  | { action: "hold"; reason: string }
  | { action: "decrease"; lever: "kcal" | "steps"; amount: number; reason: string }
  | { action: "increase"; kcalDelta: number; reason: string };

export interface CheckIn {
  weekStart: ISODate; // Monday
  avgWeightKg: number | null;
  waistCm?: number;
  decision: Decision | null; // what was applied; null until accepted or overridden
  updatedAt: number;
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
