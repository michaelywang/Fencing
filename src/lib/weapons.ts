/**
 * Weapon configuration — the single place to rename weapons or change how they
 * are styled. The actual COLORS live in `src/app/globals.css` (search for
 * "WEAPON COLORS"); the class names below reference those CSS variables, so a
 * color change never requires touching components.
 */
export const WEAPONS = ["foil", "epee", "saber"] as const;
export type Weapon = (typeof WEAPONS)[number];
export type WeaponFilter = Weapon | "all";
export type Lane = Weapon | "shared";

export const WEAPON_LABEL: Record<Weapon, string> = {
  foil: "Foil",
  epee: "Épée",
  saber: "Saber",
};

/** One-letter abbreviations used in very compact places (always paired with an aria-label). */
export const WEAPON_ABBR: Record<Weapon, string> = {
  foil: "F",
  epee: "É",
  saber: "S",
};

export const LANE_LABEL: Record<Lane, string> = {
  shared: "Shared",
  ...WEAPON_LABEL,
};

/**
 * Tailwind utility classes per lane. Tailwind generates `bg-foil`, `text-foil-ink`
 * etc. from the `--color-*` variables declared in globals.css.
 * Keep these as full literal strings so Tailwind can detect them.
 */
export const LANE_CLASSES: Record<
  Lane,
  { solid: string; soft: string; border: string; ink: string; ring: string }
> = {
  shared: {
    solid: "bg-shared text-white",
    soft: "bg-shared-soft",
    border: "border-shared",
    ink: "text-shared-ink",
    ring: "ring-shared",
  },
  foil: {
    solid: "bg-foil text-white",
    soft: "bg-foil-soft",
    border: "border-foil",
    ink: "text-foil-ink",
    ring: "ring-foil",
  },
  epee: {
    solid: "bg-epee text-white",
    soft: "bg-epee-soft",
    border: "border-epee",
    ink: "text-epee-ink",
    ring: "ring-epee",
  },
  saber: {
    solid: "bg-saber text-white",
    soft: "bg-saber-soft",
    border: "border-saber",
    ink: "text-saber-ink",
    ring: "ring-saber",
  },
};

export function isWeapon(value: unknown): value is Weapon {
  return typeof value === "string" && (WEAPONS as readonly string[]).includes(value);
}

export function parseWeaponFilter(value: unknown): WeaponFilter {
  return isWeapon(value) ? value : "all";
}

/** Cookie used to remember a reader's weapon preference on their own device. */
export const WEAPON_PREF_COOKIE = "glf_weapon";
