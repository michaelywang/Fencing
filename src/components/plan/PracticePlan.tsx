"use client";

import { useMemo, useState } from "react";
import { BLOCK_CATEGORY_LABEL } from "@/lib/constants";
import { addMinutesToTime, formatClock, formatElapsed } from "@/lib/dates";
import { buildScheduleGrid } from "@/lib/schedule";
import { analyzePractice, appliesToWeapon, sortBlocks } from "@/lib/timeline";
import { youTubeId } from "@/lib/text";
import { LANE_CLASSES, LANE_LABEL, WEAPONS, WEAPON_LABEL, type Lane, type Weapon, type WeaponFilter } from "@/lib/weapons";
import type { ViewBlock, ViewEvent } from "@/lib/view";
import { RichText, ExternalLink } from "@/components/RichText";
import { WeaponTag } from "@/components/badges";
import { Button, cx } from "@/components/ui";
import { WeaponFilterControl, useWeaponPreference } from "./WeaponFilter";

interface Props {
  event: ViewEvent;
  initialWeapon?: WeaponFilter;
  /** Persist the weapon choice on this device (public pages). */
  rememberWeapon?: boolean;
  /** Coach views: show private block notes and timing validation. */
  coachView?: boolean;
  /** Open the Shared/weapon sections initially (default true). */
  sectionsOpen?: boolean;
}

function clock(event: ViewEvent, minutes: number) {
  return event.startTime ? formatClock(addMinutesToTime(event.startTime, minutes)) : `+${formatElapsed(minutes)}`;
}

function timeRange(event: ViewEvent, b: { start: number; duration: number }) {
  return `${clock(event, b.start)} – ${clock(event, b.start + b.duration)}`;
}

export function PracticePlan({ event, initialWeapon = "all", rememberWeapon, coachView, sectionsOpen = true }: Props) {
  const [prefWeapon, setPrefWeapon] = useWeaponPreference(initialWeapon);
  const [localWeapon, setLocalWeapon] = useState<WeaponFilter>(initialWeapon);
  const weapon = rememberWeapon ? prefWeapon : localWeapon;
  const setWeapon = rememberWeapon ? setPrefWeapon : setLocalWeapon;

  const lanes: Weapon[] = weapon === "all" ? [...WEAPONS] : [weapon];
  const blocks = event.blocks;
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const grid = useMemo(() => buildScheduleGrid(blocks, lanes), [blocks, lanes.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections: Array<{ lane: Lane; blocks: ViewBlock[] }> = [
    { lane: "shared" as Lane, blocks: sortBlocks(blocks.filter((b) => b.scope === "shared")) },
    ...lanes.map((w) => ({ lane: w as Lane, blocks: sortBlocks(blocks.filter((b) => b.scope === "weapon" && appliesToWeapon(b, w))) })),
  ].filter((s) => s.blocks.length > 0);

  const allKeys = useMemo(() => [...sections.map((s) => `s:${s.lane}`), ...blocks.map((b) => `b:${b.id}`)], [sections, blocks]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(sectionsOpen ? sections.map((s) => `s:${s.lane}`) : []));
  const isOpen = (k: string) => open.has(k);
  const setKey = (k: string, v: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (v) next.add(k);
      else next.delete(k);
      return next;
    });

  const timeline = useMemo(() => (coachView ? analyzePractice(blocks, event.targetMinutes, lanes) : null), [coachView, blocks, event.targetMinutes, lanes.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (blocks.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-600">
        {event.kind === "practice" || event.kind === "recovery" ? "The practice plan hasn't been posted yet." : "No practice plan for this event."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <WeaponFilterControl value={weapon} onChange={setWeapon} label={rememberWeapon ? "My weapon" : "Weapon"} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(new Set(allKeys))}>
            Expand all
          </Button>
          <Button size="sm" onClick={() => setOpen(new Set())}>
            Collapse all
          </Button>
        </div>
      </div>

      {timeline ? (
        <div className="flex flex-wrap gap-2 text-xs" aria-label="Timing check">
          {lanes.map((w) => {
            const t = timeline.perWeapon[w];
            return (
              <span key={w} className={cx("rounded px-2 py-1 font-semibold", t.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
                {WEAPON_LABEL[w]}: {t.coveredMinutes}/{event.targetMinutes} min {t.ok ? "✓" : "⚠"}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* At-a-glance parallel schedule */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <caption className="sr-only">Practice schedule at a glance</caption>
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <th scope="col" className="w-24 px-2 py-1.5 font-semibold">
                Time
              </th>
              {lanes.map((w) => (
                <th key={w} scope="col" className="px-2 py-1.5">
                  <WeaponTag weapon={w} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.start} className="border-t border-slate-200 align-top">
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left text-xs font-semibold text-slate-600">
                  {clock(event, row.start)}
                  <span className="block font-normal text-slate-400">{row.end - row.start} min</span>
                </th>
                {row.cells.map((cell) => {
                  const items = cell.blockIds.map((id) => byId.get(id)!).filter(Boolean);
                  const lane: Lane = row.spanning ? "shared" : cell.lanes[0];
                  return (
                    <td
                      key={cell.lanes.join()}
                      colSpan={row.spanning ? lanes.length : 1}
                      rowSpan={cell.rowSpan}
                      className={cx("border-l border-slate-200 px-2 py-1.5", items.length ? LANE_CLASSES[lane].soft : "bg-[repeating-linear-gradient(45deg,#fff,#fff_6px,#f8fafc_6px,#f8fafc_12px)]")}
                    >
                      {items.length === 0 ? <span className="text-xs italic text-slate-400">—</span> : null}
                      {items.map((b) => (
                        <a
                          key={b.id}
                          href={`#block-${b.id}`}
                          onClick={() => setKey(`b:${b.id}`, true)}
                          className={cx("block rounded px-0.5 hover:underline", b.allowOverlap && "mt-1 border-t border-dashed border-slate-300 pt-1 text-xs")}
                        >
                          <span className={cx("font-semibold", LANE_CLASSES[lane].ink)}>
                            {row.spanning ? <span className="mr-1 text-[10px] font-bold uppercase text-shared-ink">Shared ·</span> : null}
                            {b.allowOverlap ? "Alongside: " : ""}
                            {b.title || "Untitled"}
                          </span>
                          <span className="ml-1 text-xs text-slate-500">{b.duration} min</span>
                        </a>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expandable sections */}
      {sections.map((s) => (
        <details
          key={s.lane}
          open={isOpen(`s:${s.lane}`)}
          onToggle={(e) => setKey(`s:${s.lane}`, (e.currentTarget as HTMLDetailsElement).open)}
          className={cx("rounded-lg border bg-white", LANE_CLASSES[s.lane].border, "border-l-4")}
        >
          <summary className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="flex items-center gap-2">
              <span className={cx("rounded px-2 py-0.5 text-sm font-bold", LANE_CLASSES[s.lane].solid)}>{LANE_LABEL[s.lane]}</span>
              <span className="text-sm text-slate-600">
                {s.blocks.length} {s.blocks.length === 1 ? "activity" : "activities"}
                {s.lane === "shared" ? " · everyone together" : ""}
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              {isOpen(`s:${s.lane}`) ? "▾" : "▸"}
            </span>
          </summary>
          <ol className="space-y-2 px-3 pb-3">
            {s.blocks.map((b) => (
              <li key={b.id}>
                <BlockCard
                  event={event}
                  block={b}
                  lane={s.lane}
                  open={isOpen(`b:${b.id}`)}
                  onToggle={(v) => setKey(`b:${b.id}`, v)}
                  coachView={coachView}
                  flagged={timeline?.flaggedBlockIds.has(b.id)}
                />
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}

function BlockCard({
  event,
  block: b,
  lane,
  open,
  onToggle,
  coachView,
  flagged,
}: {
  event: ViewEvent;
  block: ViewBlock;
  lane: Lane;
  open: boolean;
  onToggle: (v: boolean) => void;
  coachView?: boolean;
  flagged?: boolean;
}) {
  const hasDetails =
    b.objective || b.setup || b.steps.length || b.partnerRoles || b.rotation || b.successCriteria || b.notes || b.links.length || b.equipment.length ||
    Object.values(b.variations).some(Boolean) || b.sets || b.reps || b.work || b.rest || (coachView && b.privateNotes);
  const others = b.scope === "weapon" ? b.weapons.filter((w) => w !== lane) : [];
  return (
    <article id={`block-${b.id}`} className={cx("scroll-mt-24 rounded-md border bg-white", flagged ? "border-amber-400" : "border-slate-200")}>
      <div className="flex flex-col gap-x-3 gap-y-0.5 px-3 pt-2 sm:flex-row sm:items-start">
        <div className="text-sm font-bold text-slate-900 sm:min-w-[7.5rem]">
          {timeRange(event, b)}
          <span className="ml-2 text-xs font-normal text-slate-500 sm:ml-0 sm:block">
            {b.duration} min · +{formatElapsed(b.start)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold leading-snug text-slate-900">
            {b.title || "Untitled activity"}
            {b.allowOverlap ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-slate-700">Runs alongside</span> : null}
            {flagged ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-amber-900">⚠ Overlap</span> : null}
          </h4>
          <p className="text-xs text-slate-600">
            {BLOCK_CATEGORY_LABEL[b.category]}
            {others.length ? <> · with {others.map((w) => WEAPON_LABEL[w]).join(" & ")}</> : null}
            {b.coach ? <> · {b.coach}</> : null}
            {b.station ? <> · {b.station}</> : null}
          </p>
          {b.objective && !open ? <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">{b.objective}</p> : null}
        </div>
      </div>
      {b.cues.length ? (
        <ul className="flex flex-wrap gap-1.5 px-3 pt-1.5" aria-label="Key coaching cues">
          {b.cues.map((c, i) => (
            <li key={i} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">
              {c}
            </li>
          ))}
        </ul>
      ) : null}
      {hasDetails ? (
        <details open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)} className="mt-1">
          <summary className="touch-target flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-gl-blue">
            <span aria-hidden>{open ? "▾" : "▸"}</span> {open ? "Hide instructions" : "Show instructions"}
          </summary>
          <div className="space-y-3 border-t border-slate-100 px-3 py-3 text-sm">
            {b.objective ? <Section title="Objective"><RichText text={b.objective} /></Section> : null}
            {b.setup || b.equipment.length ? (
              <Section title="Setup & equipment">
                <RichText text={b.setup} />
                {b.equipment.length ? <p className="text-slate-700">Equipment: {b.equipment.join(", ")}</p> : null}
              </Section>
            ) : null}
            {b.steps.length ? (
              <Section title="Steps">
                <ol className="ml-5 list-decimal space-y-1 text-slate-800">
                  {b.steps.map((s, i) => (
                    <li key={i}>
                      <RichText text={s} className="inline" />
                    </li>
                  ))}
                </ol>
              </Section>
            ) : null}
            {b.sets || b.reps || b.work || b.rest ? (
              <p className="flex flex-wrap gap-x-4 text-slate-800">
                {b.sets ? <span><strong>Sets:</strong> {b.sets}</span> : null}
                {b.reps ? <span><strong>Reps:</strong> {b.reps}</span> : null}
                {b.work ? <span><strong>Work:</strong> {b.work}</span> : null}
                {b.rest ? <span><strong>Rest:</strong> {b.rest}</span> : null}
              </p>
            ) : null}
            {b.partnerRoles || b.rotation ? (
              <Section title="Partners & rotation">
                <RichText text={b.partnerRoles} />
                <RichText text={b.rotation} />
              </Section>
            ) : null}
            {b.successCriteria ? <Section title="Success looks like"><RichText text={b.successCriteria} /></Section> : null}
            {Object.values(b.variations).some(Boolean) ? (
              <Section title="Variations">
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {(["beginner", "experienced", "easier", "harder"] as const)
                    .filter((k) => b.variations[k])
                    .map((k) => (
                      <div key={k}>
                        <dt className="text-xs font-bold uppercase text-slate-500">{k === "beginner" ? "Beginner" : k === "experienced" ? "Experienced" : k === "easier" ? "Easier" : "Harder"}</dt>
                        <dd><RichText text={b.variations[k]} /></dd>
                      </div>
                    ))}
                </dl>
              </Section>
            ) : null}
            {b.notes ? <Section title="Notes"><RichText text={b.notes} /></Section> : null}
            {coachView && b.privateNotes ? (
              <div className="rounded-md border border-dashed border-slate-400 bg-slate-50 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">🔒 Private coach note (never shown to students)</p>
                <RichText text={b.privateNotes} />
              </div>
            ) : null}
            {b.links.length ? (
              <Section title="Video & references">
                <ul className="flex flex-wrap gap-3">
                  {b.links.map((l, i) => {
                    const yt = youTubeId(l.url);
                    return (
                      <li key={i} className="max-w-[220px]">
                        {yt ? (
                          <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`} alt="" loading="lazy" className="mb-1 aspect-video w-[200px] rounded object-cover" />
                            <span className="text-sm font-medium text-gl-blue underline">{l.label || "Watch video"}</span>
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          <ExternalLink href={l.url}>{l.label || l.url}</ExternalLink>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Section>
            ) : null}
          </div>
        </details>
      ) : (
        <div className="h-2" />
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h5>
      <div className="mt-0.5">{children}</div>
    </section>
  );
}
