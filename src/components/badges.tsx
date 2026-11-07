import { Badge, cx } from "./ui";
import {
  EVENT_KIND_LABEL,
  INTENSITY_LABEL,
  PUBLICATION_LABEL,
  type EventKind,
  type Intensity,
  type PublicationState,
} from "@/lib/constants";
import { LANE_CLASSES, LANE_LABEL, WEAPON_ABBR, WEAPON_LABEL, type Lane, type Weapon } from "@/lib/weapons";

/** Event type: icon-ish glyph + written label. Color is supportive only. */
const KIND_STYLE: Record<EventKind, { cls: string; glyph: string; short: string }> = {
  practice: { cls: "bg-gl-blue-soft text-gl-blue", glyph: "◆", short: "Practice" },
  meet: { cls: "bg-gl-red-soft text-gl-red", glyph: "⚔", short: "Meet" },
  tournament: { cls: "bg-gl-red text-white", glyph: "★", short: "Tournament" },
  recovery: { cls: "bg-teal-50 text-teal-800", glyph: "↺", short: "Recovery" },
  holiday: { cls: "bg-slate-200 text-slate-700", glyph: "○", short: "Holiday" },
  other: { cls: "bg-slate-100 text-slate-700", glyph: "•", short: "Other" },
};

export const KIND_BORDER: Record<EventKind, string> = {
  practice: "border-l-gl-blue",
  meet: "border-l-gl-red",
  tournament: "border-l-gl-red",
  recovery: "border-l-teal-600",
  holiday: "border-l-slate-400",
  other: "border-l-slate-400",
};

export function EventTypeBadge({ kind, compact }: { kind: EventKind; compact?: boolean }) {
  const s = KIND_STYLE[kind];
  return (
    <Badge className={s.cls} title={EVENT_KIND_LABEL[kind]}>
      <span aria-hidden>{s.glyph}</span>
      {compact ? s.short : EVENT_KIND_LABEL[kind]}
    </Badge>
  );
}

export function IntensityBadge({ level, compact }: { level: number | null | undefined; compact?: boolean }) {
  if (!level || level < 1 || level > 5) return null;
  const label = INTENSITY_LABEL[level as Intensity];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700" title={`Intensity ${level} of 5: ${label}`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("w-[3px] rounded-sm", i <= level ? "bg-slate-700" : "bg-slate-300")} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      <span className="sr-only">Intensity {level} of 5: </span>
      {compact ? label.slice(0, 4) : label}
    </span>
  );
}

export function PublicationBadge({ state }: { state: PublicationState }) {
  const cls =
    state === "published"
      ? "bg-emerald-100 text-emerald-900"
      : state === "changed"
        ? "bg-amber-100 text-amber-900 ring-1 ring-amber-400"
        : "bg-white text-slate-700 ring-1 ring-dashed ring-slate-400";
  const glyph = state === "published" ? "✓" : state === "changed" ? "✎" : "◌";
  return (
    <Badge className={cls} title={PUBLICATION_LABEL[state]}>
      <span aria-hidden>{glyph}</span>
      {state === "changed" ? "Changes" : PUBLICATION_LABEL[state]}
      <span className="sr-only">{state === "changed" ? " not yet published" : ""}</span>
    </Badge>
  );
}

export function TentativeBadge() {
  return (
    <Badge className="bg-white text-slate-700 ring-1 ring-slate-400 border-dashed" title="Tentative — not confirmed yet">
      <span aria-hidden>?</span>Tentative
    </Badge>
  );
}

export function CanceledBadge() {
  return (
    <Badge className="bg-red-700 text-white" title="Canceled">
      <span aria-hidden>✕</span>Canceled
    </Badge>
  );
}

export function DemoBadge() {
  return (
    <Badge className="bg-fuchsia-100 text-fuchsia-900" title="Demonstration content — fictional">
      Demo
    </Badge>
  );
}

export function WeaponTag({ weapon, abbr, className }: { weapon: Weapon; abbr?: boolean; className?: string }) {
  const c = LANE_CLASSES[weapon];
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold leading-4", c.solid, abbr && "min-w-4", className)}
      aria-label={abbr ? WEAPON_LABEL[weapon] : undefined}
      title={WEAPON_LABEL[weapon]}
    >
      {abbr ? WEAPON_ABBR[weapon] : WEAPON_LABEL[weapon]}
    </span>
  );
}

export function LaneTag({ lane, className }: { lane: Lane; className?: string }) {
  const c = LANE_CLASSES[lane];
  return <span className={cx("inline-flex items-center rounded px-1.5 text-[11px] font-bold leading-5", c.solid, className)}>{LANE_LABEL[lane]}</span>;
}
