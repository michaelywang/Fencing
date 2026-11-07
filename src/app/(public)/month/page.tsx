import Link from "next/link";
import { cookies } from "next/headers";
import { PublicMonth } from "@/components/public/PublicMonth";
import { WeaponPreferencePicker } from "@/components/plan/WeaponFilter";
import { buttonClass } from "@/components/ui";
import { getPhasesInRange, getPublicEvents, getPublicMeta } from "@/server/services/public";
import { addMonths, formatMonthYear, monthGrid, monthKey, monthOf, parseMonthKey, todayInTimeZone } from "@/lib/dates";
import { fromPublic } from "@/lib/view";
import { WEAPON_PREF_COOKIE, parseWeaponFilter } from "@/lib/weapons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Month" };

export default async function PublicMonthPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const meta = await getPublicMeta();
  const today = todayInTimeZone(meta.timezone);
  const { year, month } = parseMonthKey(m) ?? monthOf(today);
  const grid = monthGrid(year, month);
  const from = grid[0][0];
  const to = grid[grid.length - 1][6];
  const events = (await getPublicEvents(from, to)).map(fromPublic);
  const phases = await getPhasesInRange(from, to);
  const weapon = parseWeaponFilter((await cookies()).get(WEAPON_PREF_COOKIE)?.value);
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{formatMonthYear(year, month)}</h1>
        <nav className="flex gap-2" aria-label="Change month">
          <Link className={buttonClass("secondary", "sm")} href={`/month?m=${monthKey(prev.year, prev.month)}`}>
            ‹ Previous
          </Link>
          <Link className={buttonClass("secondary", "sm")} href="/month">
            Today
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={`/month?m=${monthKey(next.year, next.month)}`}>
            Next ›
          </Link>
        </nav>
      </div>
      <WeaponPreferencePicker initial={weapon} />
      <PublicMonth year={year} month={month} today={today} events={events} phases={phases} weapon={weapon} />
    </div>
  );
}
