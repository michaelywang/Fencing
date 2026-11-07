"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cx } from "@/components/ui";
import { WEAPONS, WEAPON_LABEL, WEAPON_PREF_COOKIE, type WeaponFilter } from "@/lib/weapons";

const OPTIONS: Array<{ value: WeaponFilter; label: string }> = [{ value: "all", label: "All" }, ...WEAPONS.map((w) => ({ value: w, label: WEAPON_LABEL[w] }))];

const ACTIVE: Record<WeaponFilter, string> = {
  all: "bg-gl-blue text-white border-gl-blue",
  foil: "bg-foil text-white border-foil",
  epee: "bg-epee text-white border-epee",
  saber: "bg-saber text-white border-saber",
};

/** Segmented control; never relies on color alone (labels + aria-pressed). */
export function WeaponFilterControl({
  value,
  onChange,
  label = "Weapon",
  size = "md",
}: {
  value: WeaponFilter;
  onChange: (v: WeaponFilter) => void;
  label?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "touch-target rounded-md border font-semibold transition-colors",
            size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm",
            value === o.value ? ACTIVE[o.value] : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Remembers a reader's weapon on THIS device (cookie, 1 year) — no account needed. */
export function useWeaponPreference(initial: WeaponFilter, opts: { refresh?: boolean } = {}) {
  const router = useRouter();
  const [weapon, setWeapon] = useState<WeaponFilter>(initial);
  const update = useCallback(
    (w: WeaponFilter) => {
      setWeapon(w);
      document.cookie = `${WEAPON_PREF_COOKIE}=${w}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      if (opts.refresh) router.refresh();
    },
    [router, opts.refresh],
  );
  return [weapon, update] as const;
}

/** Stand-alone preference picker for public pages (persists + refreshes server-rendered views). */
export function WeaponPreferencePicker({ initial }: { initial: WeaponFilter }) {
  const [weapon, setWeapon] = useWeaponPreference(initial, { refresh: true });
  return <WeaponFilterControl value={weapon} onChange={setWeapon} label="My weapon" />;
}
