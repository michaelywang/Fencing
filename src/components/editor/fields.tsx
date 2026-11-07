"use client";

import { useId, useState, type ReactNode } from "react";
import { cx, inputClass } from "@/components/ui";

export function FieldLabel({ htmlFor, children, hint, priv }: { htmlFor: string; children: ReactNode; hint?: ReactNode; priv?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold text-slate-700">
      {children}
      {priv ? <span className="rounded bg-slate-800 px-1 text-[10px] font-bold uppercase text-white">🔒 Private</span> : null}
      {hint ? <span className="font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = "text",
  list,
  className,
  priv,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  type?: string;
  list?: string;
  className?: string;
  priv?: boolean;
  inputMode?: "text" | "numeric" | "url" | "email";
}) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint} priv={priv}>
        {label}
      </FieldLabel>
      <input id={id} type={type} list={list} inputMode={inputMode} className={inputClass} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  rows = 3,
  placeholder,
  className,
  priv,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  rows?: number;
  placeholder?: string;
  className?: string;
  priv?: boolean;
}) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint} priv={priv}>
        {label}
      </FieldLabel>
      <textarea
        id={id}
        rows={rows}
        className={cx(inputClass, "min-h-[2.5rem] resize-y leading-snug", priv && "border-dashed border-slate-500 bg-slate-50")}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Edits a string[] as one item per line, without fighting the cursor. */
export function LinesField({
  label,
  value,
  onChange,
  hint = "(one per line)",
  rows = 3,
  placeholder,
  className,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  hint?: ReactNode;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value.join("\n"));
  const [seen, setSeen] = useState(value);
  // Re-sync only when the value changes from outside (e.g. conflict resolution, restore).
  if (seen !== value) {
    setSeen(value);
    const parsed = text.split("\n").map((s) => s.trim()).filter(Boolean);
    if (JSON.stringify(parsed) !== JSON.stringify(value)) setText(value.join("\n"));
  }
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      <textarea
        id={id}
        rows={rows}
        className={cx(inputClass, "resize-y leading-snug")}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
        }}
      />
    </div>
  );
}

/** Comma-separated list (equipment, tags). */
export function CommaField({ label, value, onChange, hint = "(comma-separated)", className, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: ReactNode; className?: string; placeholder?: string }) {
  const id = useId();
  const [text, setText] = useState(value.join(", "));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    const parsed = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (JSON.stringify(parsed) !== JSON.stringify(value)) setText(value.join(", "));
  }
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      <input
        id={id}
        className={inputClass}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean));
        }}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  hint?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value == null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if ((text === "" ? null : Number(text)) !== value) setText(value == null ? "" : String(value));
  }
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className={inputClass}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === "") onChange(null);
          else {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
          }
        }}
      />
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckboxField({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm text-slate-800">
        {label}
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </label>
    </div>
  );
}

export function TimeField({ label, value, onChange, className, allowEmpty = true }: { label: string; value: string | null; onChange: (v: string | null) => void; className?: string; allowEmpty?: boolean }) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="time"
        step={300}
        className={inputClass}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? e.target.value.slice(0, 5) : allowEmpty ? null : value)}
      />
    </div>
  );
}
