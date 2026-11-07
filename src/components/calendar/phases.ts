export interface PhaseLite {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
  color: string;
}

export const PHASE_CLASSES: Record<string, { bar: string; soft: string; text: string }> = {
  slate: { bar: "bg-slate-500", soft: "bg-slate-100", text: "text-slate-800" },
  sky: { bar: "bg-sky-600", soft: "bg-sky-50", text: "text-sky-900" },
  emerald: { bar: "bg-emerald-600", soft: "bg-emerald-50", text: "text-emerald-900" },
  amber: { bar: "bg-amber-500", soft: "bg-amber-50", text: "text-amber-900" },
  rose: { bar: "bg-rose-600", soft: "bg-rose-50", text: "text-rose-900" },
  violet: { bar: "bg-violet-600", soft: "bg-violet-50", text: "text-violet-900" },
};

export const phaseClass = (color: string) => PHASE_CLASSES[color] ?? PHASE_CLASSES.sky;

export function phaseOn(phases: readonly PhaseLite[], date: string): PhaseLite | null {
  return phases.find((p) => p.startDate <= date && p.endDate >= date) ?? null;
}
