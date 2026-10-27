import type { Day, Slot } from "./types";

type SlotDef = Omit<Slot, "day">;

// Source: Ripped Body Novice Bodybuilding Program (Helms, Morgan, Valdez).
// incKg/incLb: default load jump. rest: seconds.
const DAYS: { day: number; title: string; focus: string; slots: SlotDef[] }[] = [
  { day: 1, title: "Lower body", focus: "Strength", slots: [
    { id: "d1-squat", name: "Squat", sets: 3, reps: 5, incKg: 5, incLb: 10, rest: 180,
      variants: ["Back squat (high bar)", "Back squat (low bar)", "Front squat", "Safety-bar squat", "Leg press (if injured)"] },
    { id: "d1-dl", name: "Deadlift", sets: 3, reps: 5, incKg: 5, incLb: 10, rest: 180,
      variants: ["Conventional deadlift", "Sumo deadlift", "Trap bar deadlift", "Romanian deadlift", "Good morning"] },
    { id: "d1-sl", name: "Single-leg", sets: 3, reps: 8, incKg: 2.5, incLb: 5, rest: 120,
      variants: ["Bulgarian split squat", "Lunge", "Pistol squat (DB or KB)"] },
    { id: "d1-calf", name: "Straight-leg calf raise", sets: 4, reps: 8, incKg: 2.5, incLb: 5, rest: 90,
      variants: ["Standing calf raise", "Smith machine calf raise", "Leg press calf raise"] },
  ]},
  { day: 2, title: "Upper body", focus: "Strength", slots: [
    { id: "d2-hpush", name: "Horizontal push", sets: 3, reps: 5, incKg: 2.5, incLb: 5, rest: 180,
      variants: ["Bench press", "Dumbbell bench press"] },
    { id: "d2-hpull", name: "Horizontal pull", sets: 3, reps: 5, incKg: 2.5, incLb: 5, rest: 150,
      variants: ["Seated cable row", "Dumbbell row", "Seal row", "Machine row", "TRX row"] },
    { id: "d2-vpush", name: "Vertical push", sets: 2, reps: 8, incKg: 2.5, incLb: 5, rest: 150,
      variants: ["Overhead barbell press", "Dumbbell overhead press", "Landmine press"] },
    { id: "d2-vpull", name: "Vertical pull", sets: 2, reps: 8, incKg: 2.5, incLb: 5, rest: 150, bw: true,
      variants: ["Chin-up", "Pull-up", "Lat pulldown"] },
    { id: "d2-fly", name: "Flys", sets: 2, reps: 15, incKg: 2.5, incLb: 5, rest: 75,
      variants: ["Cable fly", "Dumbbell fly", "Machine fly"] },
  ]},
  { day: 3, title: "Lower body", focus: "Volume", slots: [
    { id: "d3-hinge", name: "Hip hinge", sets: 3, reps: 8, incKg: 5, incLb: 10, rest: 150,
      variants: ["Barbell hip thrust", "Barbell glute bridge", "Cable pull-through"] },
    { id: "d3-press", name: "Leg press", sets: 3, reps: 8, incKg: 5, incLb: 10, rest: 150,
      variants: ["Seated leg press", "45° leg press", "Hack squat"] },
    { id: "d3-ext", name: "Leg extension", sets: 3, reps: 12, incKg: 2.5, incLb: 5, rest: 75, variants: ["Leg extension"] },
    { id: "d3-curl", name: "Leg curl", sets: 3, reps: 12, incKg: 2.5, incLb: 5, rest: 75, variants: ["Seated leg curl", "Lying leg curl"] },
    { id: "d3-calf", name: "Seated calf raise", sets: 4, reps: 15, incKg: 2.5, incLb: 5, rest: 75, variants: ["Seated calf raise"] },
  ]},
  { day: 4, title: "Upper body", focus: "Volume", slots: [
    { id: "d4-hpush", name: "Horizontal push", sets: 3, reps: 10, incKg: 2.5, incLb: 5, rest: 150,
      variants: ["Bench press", "Dumbbell bench press", "Machine chest press"] },
    { id: "d4-hpull", name: "Horizontal pull", sets: 3, reps: 10, incKg: 2.5, incLb: 5, rest: 150,
      variants: ["Seated cable row", "Dumbbell row", "Seal row", "Machine row", "TRX row"] },
    { id: "d4-incline", name: "Incline push", sets: 2, reps: 12, incKg: 2.5, incLb: 5, rest: 120,
      variants: ["Incline dumbbell press", "Incline barbell press", "Incline machine press"] },
    { id: "d4-vpull", name: "Vertical pull", sets: 2, reps: 12, incKg: 2.5, incLb: 5, rest: 120, bw: true,
      variants: ["Lat pulldown", "Chin-up", "Pull-up"] },
    { id: "d4-tri", name: "Triceps", sets: 2, reps: 12, incKg: 2.5, incLb: 5, rest: 75,
      variants: ["Cable pushdown", "Overhead cable extension", "Skull crusher", "Machine triceps extension"] },
    { id: "d4-bi", name: "Biceps", sets: 2, reps: 12, incKg: 2.5, incLb: 5, rest: 75,
      variants: ["Dumbbell curl", "Cable curl", "Barbell curl", "Machine curl"] },
  ]},
];

export const PROGRAM: Day[] = DAYS.map((d) => ({ ...d, slots: d.slots.map((s) => ({ ...s, day: d.day })) }));

export const SLOT: Record<string, Slot> = Object.fromEntries(PROGRAM.flatMap((d) => d.slots.map((s) => [s.id, s])));

// Rep-range ceiling once an exercise moves to autoregulated double progression
export const TOP: Record<number, number> = { 5: 7, 8: 10, 10: 12, 12: 15, 15: 20 };

// sessions in a row without a load jump before switching methods
export const STALL_LIMIT = 3;
