import { KCAL_FLOOR } from "@/lib/cut";
import type { CutDraft, CutTargets } from "@/lib/types";
import NumField from "./NumField";

// Every personal number for the cut, used by first-time setup and by Settings.
export default function CutForm({ cut, onChange }: { cut: CutDraft; onChange: (patch: Partial<CutDraft>) => void }) {
  const num = (label: string, value: number | null, apply: (n: number | null) => void, placeholder?: string, hint?: string, min = 0) => (
    <label>
      {label}
      <NumField value={value} label={label} placeholder={placeholder} onChange={(n) => { if (n == null || n >= min) apply(n); }} />
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
  const target = (label: string, k: keyof CutTargets, placeholder?: string, hint?: string, min = 0) =>
    num(label, cut.targets[k], (n) => onChange({ targets: { ...cut.targets, [k]: n } }), placeholder, hint, min);
  const date = (label: string, k: "startDate" | "goalDate") => (
    <label>
      {label}
      <input type="date" value={cut[k] ?? ""} onChange={(e) => onChange({ [k]: e.target.value || null })} />
    </label>
  );

  return (
    <div className="slotcfg" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="grid">
        {num("Height (cm)", cut.heightCm, (n) => onChange({ heightCm: n }), "e.g. 175", undefined, 100)}
        {num("Age", cut.age, (n) => onChange({ age: n }), "e.g. 30", undefined, 10)}
        <label className="full">
          Sex (for the calorie estimate)
          <select value={cut.sex ?? ""} onChange={(e) => onChange({ sex: (e.target.value || null) as CutDraft["sex"] })}>
            <option value="" disabled>Choose</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        {date("Start date", "startDate")}
        {date("Goal date", "goalDate")}
        {num("Start weight (kg)", cut.startWeightKg, (n) => onChange({ startWeightKg: n }), "e.g. 85", undefined, 20)}
        {num("Goal weight (kg)", cut.goalWeightKg, (n) => onChange({ goalWeightKg: n }), "e.g. 78", undefined, 20)}
        {num("Goal band low (kg)", cut.goalBandKg[0], (n) => onChange({ goalBandKg: [n, cut.goalBandKg[1]] }), "e.g. 77", undefined, 20)}
        {num("Goal band high (kg)", cut.goalBandKg[1], (n) => onChange({ goalBandKg: [cut.goalBandKg[0], n] }), "e.g. 79", undefined, 20)}
        {target("Calories", "kcal", "e.g. 2,000", `At least ${KCAL_FLOOR.toLocaleString()}`, KCAL_FLOOR)}
        {target("Protein (g)", "proteinG", "e.g. 150")}
        {target("Fat (g)", "fatG", "e.g. 60")}
        {target("Carbs (g)", "carbsG", "e.g. 180")}
        {target("Fibre (g)", "fibreG")}
        {target("Lifts per week", "liftsPerWeek")}
        {target("Steps floor", "stepsFloor")}
        {target("Steps goal", "stepsGoal")}
        {num("Activity factor", cut.activityFactor, (n) => onChange({ activityFactor: n }), undefined, "1.4–1.5 with steps and lifting", 1)}
      </div>
    </div>
  );
}
