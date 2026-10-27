import { useState } from "react";
import { fmt, num } from "@/lib/engine";

// Keeps the typed text (e.g. "62.") while the stored number is 62; resyncs when the number changes elsewhere.
export default function NumField({ value, onChange, placeholder, label, className }: {
  value: number | null | undefined;
  onChange: (n: number | null, text: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const v = value ?? null;
  const [text, setText] = useState(fmt(v));
  const [seen, setSeen] = useState(v);
  if (v !== seen) {
    setSeen(v);
    if (num(text) !== v) setText(fmt(v));
  }
  return (
    <input
      className={className}
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === "" ? null : num(e.target.value), e.target.value);
      }}
    />
  );
}
