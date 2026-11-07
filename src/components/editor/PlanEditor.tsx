"use client";

import { useMemo, useState } from "react";
import { BLOCK_CATEGORIES, BLOCK_CATEGORY_LABEL, type BlockCategory } from "@/lib/constants";
import { addMinutesToTime, formatClock, formatElapsed, minutesBetween } from "@/lib/dates";
import { analyzePractice, appliesToWeapon, blockEnd, categoryTotals, sortBlocks, summarizeIssues } from "@/lib/timeline";
import { packBlocks } from "@/lib/sequencing";
import { newBlockId } from "@/lib/practice";
import { drillInputFromBlock, refreshBlockFromDrill, type LibraryDrill } from "@/lib/drills";
import type { Block, EventDoc } from "@/lib/schemas";
import { LANE_CLASSES, LANE_LABEL, WEAPONS, WEAPON_LABEL, type Lane, type Weapon } from "@/lib/weapons";
import { api, ApiError } from "@/lib/api-client";
import { Button, cx } from "@/components/ui";
import { LaneTag } from "@/components/badges";
import { useCoach, useToast } from "@/components/coach/CoachContext";
import { CheckboxField, CommaField, LinesField, NumberField, SelectField, TextArea, TextField, TimeField } from "./fields";
import { DrillPicker } from "./DrillPicker";

type Update = (fn: (d: EventDoc) => EventDoc) => void;

const LANES: Lane[] = ["shared", ...WEAPONS];

export function emptyBlock(lane: Lane, start: number, duration = 15): Block {
  return {
    id: newBlockId(),
    scope: lane === "shared" ? "shared" : "weapon",
    weapons: lane === "shared" ? [] : [lane],
    start,
    duration,
    category: lane === "shared" ? "warmup" : "technical",
    title: "",
    coach: "",
    station: "",
    allowOverlap: false,
    notes: "",
    privateNotes: "",
    source: null,
    objective: "",
    setup: "",
    equipment: [],
    steps: [],
    partnerRoles: "",
    rotation: "",
    cues: [],
    successCriteria: "",
    variations: { beginner: "", experienced: "", easier: "", harder: "" },
    sets: "",
    reps: "",
    work: "",
    rest: "",
    links: [],
  };
}

function laneBlocks(blocks: Block[], lane: Lane): Block[] {
  return sortBlocks(blocks.filter((b) => (lane === "shared" ? b.scope === "shared" : b.scope === "weapon" && appliesToWeapon(b, lane))));
}

/** End of the last scheduled minute that applies to a lane (shared blocks count for every lane). */
export function laneEnd(blocks: Block[], lane: Lane): number {
  const relevant = lane === "shared" ? blocks : blocks.filter((b) => appliesToWeapon(b, lane));
  return relevant.filter((b) => !b.allowOverlap).reduce((m, b) => Math.max(m, blockEnd(b)), 0);
}

export function PlanEditor({ doc, update, wide }: { doc: EventDoc; update: Update; wide?: boolean }) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "replace"; blockId: string } | null>(null);
  const timeline = useMemo(() => analyzePractice(doc.blocks, doc.targetMinutes), [doc.blocks, doc.targetMinutes]);
  const issues = useMemo(() => summarizeIssues(timeline), [timeline]);

  const setBlocks = (fn: (blocks: Block[]) => Block[]) => update((d) => ({ ...d, blocks: fn(d.blocks) }));
  const patchBlock = (id: string, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  function addBlock(lane: Lane) {
    const b = emptyBlock(lane, laneEnd(doc.blocks, lane));
    setBlocks((bs) => [...bs, b]);
    setOpenId(b.id);
  }

  function removeBlock(id: string) {
    const removed = doc.blocks.find((b) => b.id === id);
    if (!removed) return;
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    toast({ message: `Removed “${removed.title || "untitled block"}”.`, action: { label: "Undo", onClick: () => setBlocks((bs) => (bs.some((b) => b.id === id) ? bs : [...bs, removed])) } });
  }

  function duplicateBlock(id: string) {
    const src = doc.blocks.find((b) => b.id === id);
    if (!src) return;
    const copy = { ...src, id: newBlockId(), start: blockEnd(src) };
    setBlocks((bs) => [...bs, copy]);
    setOpenId(copy.id);
  }

  /** Swap a block with its neighbor in a lane, keeping the pair's combined time slot. */
  function moveBlock(id: string, lane: Lane, dir: -1 | 1) {
    const list = laneBlocks(doc.blocks, lane).filter((b) => !b.allowOverlap);
    const i = list.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const [first, second] = dir === 1 ? [list[i], list[j]] : [list[j], list[i]];
    const contiguous = blockEnd(first) === second.start;
    const newSecondStart = first.start;
    const newFirstStart = contiguous ? first.start + second.duration : second.start;
    setBlocks((bs) => bs.map((b) => (b.id === second.id ? { ...b, start: newSecondStart } : b.id === first.id ? { ...b, start: newFirstStart } : b)));
  }

  function pack() {
    const starts = packBlocks(doc.blocks);
    const before = doc.blocks;
    setBlocks((bs) => bs.map((b) => ({ ...b, start: starts.get(b.id) ?? b.start })));
    toast({ message: "Timings packed: gaps and overlaps removed in each lane.", action: { label: "Undo", onClick: () => setBlocks(() => before) } });
  }

  function addFromLibrary(blocks: Block[]) {
    setBlocks((bs) => [...bs, ...blocks]);
    if (blocks[0]) setOpenId(blocks[0].id);
    toast({ message: `Added ${blocks.length === 1 ? `“${blocks[0].title}”` : `${blocks.length} drills`} as an editable copy.`, tone: "success" });
  }

  function replaceFromLibrary(blockId: string, drill: LibraryDrill) {
    setBlocks((bs) => bs.map((b) => (b.id === blockId ? refreshBlockFromDrill(b, drill) : b)));
    toast({ message: `Replaced with “${drill.title}” (copy of library version ${drill.version}).`, tone: "success" });
  }

  const endClock = doc.startTime ? formatClock(addMinutesToTime(doc.startTime, doc.targetMinutes)) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <TimeField label="Practice starts" value={doc.startTime} onChange={(v) => update((d) => ({ ...d, startTime: v }))} className="w-36" />
        <NumberField label="Target minutes" value={doc.targetMinutes} min={0} max={720} onChange={(v) => update((d) => ({ ...d, targetMinutes: v ?? 0 }))} className="w-32" />
        <div className="pb-1 text-sm text-slate-700">
          {endClock ? (
            <>
              Ends <strong>{endClock}</strong>
              {doc.endTime && doc.startTime && minutesBetween(doc.startTime, doc.endTime) !== doc.targetMinutes ? (
                <Button size="sm" variant="ghost" className="ml-1 text-gl-blue underline" onClick={() => update((d) => ({ ...d, endTime: d.startTime ? addMinutesToTime(d.startTime, d.targetMinutes) : d.endTime }))}>
                  Set end time to {endClock}
                </Button>
              ) : null}
            </>
          ) : (
            "Add a start time to see clock times."
          )}
        </div>
      </div>

      <TimingSummary doc={doc} timeline={timeline} issues={issues} />

      <div className="flex flex-wrap gap-1.5">
        {LANES.map((lane) => (
          <Button key={lane} size="sm" onClick={() => addBlock(lane)} className={cx("border-l-4", LANE_CLASSES[lane].border)}>
            + {LANE_LABEL[lane]} block
          </Button>
        ))}
        <Button size="sm" variant="primary" onClick={() => setPicker({ mode: "add" })}>
          + From drill library
        </Button>
        <Button size="sm" variant="ghost" onClick={pack} disabled={doc.blocks.length === 0} title="Remove gaps and overlaps by running each lane back-to-back in its current order">
          Pack timings
        </Button>
      </div>

      {doc.blocks.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-600">
          No activities yet. Start with a <strong>Shared</strong> warm-up, add parallel <strong>Foil / Épée / Saber</strong> blocks, or insert drills from the library. Foil, épée, and saber blocks that happen at the same time run in parallel — they are not added together.
        </p>
      ) : null}

      <div className={cx(wide ? "grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-4" : "space-y-3")}>
        {LANES.map((lane) => {
          const list = laneBlocks(doc.blocks, lane);
          const minutes = lane === "shared" ? timeline.perWeapon.foil.sharedMinutes : timeline.perWeapon[lane].weaponMinutes;
          return (
            <section key={lane} aria-label={`${LANE_LABEL[lane]} activities`} className={cx("rounded-lg border border-l-4 bg-white", LANE_CLASSES[lane].border)}>
              <header className={cx("flex items-center justify-between gap-2 rounded-t-lg px-2 py-1.5", LANE_CLASSES[lane].soft)}>
                <LaneTag lane={lane} />
                <span className="text-xs font-semibold text-slate-700">
                  {minutes} min {lane === "shared" ? "together" : "in parallel"}
                </span>
              </header>
              {list.length === 0 ? <p className="px-2 py-2 text-xs text-slate-500">None</p> : null}
              <ol className="divide-y divide-slate-100">
                {list.map((b, idx) => (
                  <li key={b.id}>
                    <BlockRow
                      doc={doc}
                      block={b}
                      lane={lane}
                      first={idx === 0}
                      last={idx === list.length - 1}
                      flagged={timeline.flaggedBlockIds.has(b.id)}
                      open={openId === b.id}
                      onToggle={() => setOpenId((cur) => (cur === b.id ? null : b.id))}
                      onPatch={(p) => patchBlock(b.id, p)}
                      onRemove={() => removeBlock(b.id)}
                      onDuplicate={() => duplicateBlock(b.id)}
                      onMove={(dir) => moveBlock(b.id, lane, dir)}
                      onReplace={() => setPicker({ mode: "replace", blockId: b.id })}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      <DrillPicker
        open={picker !== null}
        mode={picker?.mode ?? "add"}
        doc={doc}
        onClose={() => setPicker(null)}
        onAdd={(blocks) => {
          addFromLibrary(blocks);
          setPicker(null);
        }}
        onReplace={(drill) => {
          if (picker?.mode === "replace") replaceFromLibrary(picker.blockId, drill);
          setPicker(null);
        }}
      />
    </div>
  );
}

function TimingSummary({ doc, timeline, issues }: { doc: EventDoc; timeline: ReturnType<typeof analyzePractice>; issues: ReturnType<typeof summarizeIssues> }) {
  const [showDetails, setShowDetails] = useState(false);
  if (doc.blocks.length === 0) return null;
  return (
    <div className={cx("rounded-lg border px-3 py-2", timeline.ok ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50")} aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-900">{timeline.ok ? "✓ Timing checks out" : "⚠ Timing warnings"}</span>
        {WEAPONS.map((w) => {
          const t = timeline.perWeapon[w];
          return (
            <span key={w} className={cx("rounded px-1.5 py-0.5 text-xs font-semibold", t.ok ? "bg-white text-emerald-900" : "bg-white text-amber-900 ring-1 ring-amber-400")}>
              {WEAPON_LABEL[w]} {t.coveredMinutes}/{doc.targetMinutes} min {t.ok ? "✓" : "⚠"}
            </span>
          );
        })}
        <button type="button" className="ml-auto text-xs font-semibold text-gl-blue underline" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
          {showDetails ? "Hide totals" : "Totals & details"}
        </button>
      </div>
      {issues.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-950">
          {issues.slice(0, showDetails ? 50 : 4).map((i) => (
            <li key={i.key}>
              {i.weapons.length === 3 ? "All weapons" : i.weapons.map((w) => WEAPON_LABEL[w]).join(", ")}: {i.message}
            </li>
          ))}
          {!showDetails && issues.length > 4 ? <li>…and {issues.length - 4} more</li> : null}
        </ul>
      ) : null}
      {issues.length ? <p className="mt-1 text-xs text-slate-600">Warnings never block saving. Mark intentional overlaps (e.g. lessons during bouting) with “Runs alongside”.</p> : null}
      {showDetails ? (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-0.5 pr-2 font-semibold">Weapon</th>
              <th className="pr-2 font-semibold">Shared</th>
              <th className="pr-2 font-semibold">Own</th>
              <th className="pr-2 font-semibold">Total</th>
              <th className="font-semibold">By category</th>
            </tr>
          </thead>
          <tbody>
            {WEAPONS.map((w) => {
              const t = timeline.perWeapon[w];
              const cats = categoryTotals(doc.blocks, w);
              return (
                <tr key={w} className="border-t border-black/5 align-top">
                  <td className="py-0.5 pr-2 font-semibold">{WEAPON_LABEL[w]}</td>
                  <td className="pr-2">{t.sharedMinutes}</td>
                  <td className="pr-2">{t.weaponMinutes}</td>
                  <td className="pr-2 font-semibold">{t.coveredMinutes}</td>
                  <td>
                    {Object.entries(cats)
                      .map(([k, v]) => `${BLOCK_CATEGORY_LABEL[k as BlockCategory] ?? k} ${v}`)
                      .join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function BlockRow({
  doc,
  block: b,
  lane,
  first,
  last,
  flagged,
  open,
  onToggle,
  onPatch,
  onRemove,
  onDuplicate,
  onMove,
  onReplace,
}: {
  doc: EventDoc;
  block: Block;
  lane: Lane;
  first: boolean;
  last: boolean;
  flagged: boolean;
  open: boolean;
  onToggle: () => void;
  onPatch: (p: Partial<Block>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onReplace: () => void;
}) {
  const t = (m: number) => (doc.startTime ? formatClock(addMinutesToTime(doc.startTime, m), { compact: true }) : `+${formatElapsed(m)}`);
  const others = b.scope === "weapon" ? b.weapons.filter((w) => w !== lane) : [];
  return (
    <div className={cx(open && "bg-slate-50")}>
      <div className="flex items-start gap-1 px-2 py-1.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 rounded text-left">
          <span className="block text-xs font-semibold text-slate-600">
            {t(b.start)}–{t(blockEnd(b))} · {b.duration} min · {BLOCK_CATEGORY_LABEL[b.category]}
          </span>
          <span className="block text-sm font-semibold leading-snug text-slate-900">
            {b.title || <span className="italic text-slate-400">Untitled — tap to edit</span>}
          </span>
          <span className="flex flex-wrap gap-1">
            {flagged ? <span className="rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">⚠ Overlap</span> : null}
            {b.allowOverlap ? <span className="rounded bg-slate-200 px-1 text-[11px] font-semibold text-slate-700">Runs alongside</span> : null}
            {others.length ? <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-700">with {others.map((w) => WEAPON_LABEL[w]).join(", ")}</span> : null}
            {b.source ? <span className="rounded bg-sky-50 px-1 text-[11px] text-sky-900">Library copy v{b.source.version}</span> : null}
            {b.coach ? <span className="text-[11px] text-slate-600">{b.coach}</span> : null}
            {b.privateNotes ? <span className="text-[11px] text-slate-600">🔒 note</span> : null}
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
          <IconBtn label="Move earlier" onClick={() => onMove(-1)} disabled={first || b.allowOverlap}>
            ↑
          </IconBtn>
          <IconBtn label="Move later" onClick={() => onMove(1)} disabled={last || b.allowOverlap}>
            ↓
          </IconBtn>
          <IconBtn label={open ? "Close editor" : "Edit block"} onClick={onToggle}>
            {open ? "▴" : "✎"}
          </IconBtn>
        </div>
      </div>
      {open ? <BlockForm doc={doc} block={b} onPatch={onPatch} onRemove={onRemove} onDuplicate={onDuplicate} onReplace={onReplace} /> : null}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="touch-target flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function BlockForm({
  doc,
  block: b,
  onPatch,
  onRemove,
  onDuplicate,
  onReplace,
}: {
  doc: EventDoc;
  block: Block;
  onPatch: (p: Partial<Block>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onReplace: () => void;
}) {
  const { coachNames } = useCoach();
  const toast = useToast();
  const [libState, setLibState] = useState<string | null>(null);
  const startClock = doc.startTime ? addMinutesToTime(doc.startTime, b.start) : null;
  const listId = `coach-names-${b.id}`;

  function setLane(next: { scope: "shared" | "weapon"; weapons: Weapon[] }) {
    onPatch({ scope: next.scope, weapons: next.scope === "shared" ? [] : next.weapons.length ? next.weapons : ["foil"] });
  }

  async function saveToLibrary(includePrivate: boolean) {
    setLibState("saving");
    try {
      const res = await api<{ drill: LibraryDrill }>("/api/drills", { body: { drill: drillInputFromBlock(b, { includePrivateNotes: includePrivate }) } });
      onPatch({ source: { drillId: res.drill.id, version: res.drill.version, copiedAt: new Date().toISOString(), title: res.drill.title } });
      toast({ message: `Saved “${res.drill.title}” to the drill library.`, tone: "success" });
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : "Could not save to the library.", tone: "error" });
    } finally {
      setLibState(null);
    }
  }

  async function checkLibrary() {
    if (!b.source) return;
    setLibState("checking");
    try {
      const res = await api<{ drill: LibraryDrill & { deletedAt: string | null } }>(`/api/drills/${b.source.drillId}`);
      if (res.drill.version > b.source.version) {
        if (window.confirm(`The library now has version ${res.drill.version} of “${res.drill.title}”. Replace this practice's copy (instructions, cues, variations, links)? Time slot, lane, coach and notes stay the same.`)) {
          onPatch(refreshBlockFromDrill(b, res.drill));
          toast({ message: "Updated this block from the library.", tone: "success" });
        }
      } else {
        toast({ message: "This copy matches the latest library version." });
      }
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : "Could not reach the library.", tone: "error" });
    } finally {
      setLibState(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-200 px-2 pb-3 pt-2">
      <datalist id={listId}>
        {coachNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <TextField label="Title" value={b.title} onChange={(v) => onPatch({ title: v })} placeholder="e.g. Parry 4 – riposte" />
        <SelectField label="Category" value={b.category} onChange={(v) => onPatch({ category: v })} options={BLOCK_CATEGORIES.map((c) => ({ value: c, label: BLOCK_CATEGORY_LABEL[c] }))} />
      </div>
      <fieldset className="rounded-md border border-slate-200 px-2 py-1.5">
        <legend className="px-1 text-xs font-semibold text-slate-700">Who</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`scope-${b.id}`} checked={b.scope === "shared"} onChange={() => setLane({ scope: "shared", weapons: [] })} />
            Shared (everyone together)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`scope-${b.id}`} checked={b.scope === "weapon"} onChange={() => setLane({ scope: "weapon", weapons: b.weapons.length ? b.weapons : ["foil"] })} />
            Weapon group:
          </label>
          {WEAPONS.map((w) => (
            <label key={w} className={cx("flex items-center gap-1", b.scope === "shared" && "opacity-40")}>
              <input
                type="checkbox"
                disabled={b.scope === "shared"}
                checked={b.scope === "weapon" && b.weapons.includes(w)}
                onChange={(e) => setLane({ scope: "weapon", weapons: e.target.checked ? [...b.weapons, w] : b.weapons.filter((x) => x !== w) })}
              />
              {WEAPON_LABEL[w]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {startClock ? (
          <TimeField label="Starts" value={startClock} allowEmpty={false} onChange={(v) => v && onPatch({ start: Math.max(0, minutesBetween(doc.startTime!, v)) })} />
        ) : (
          <NumberField label="Starts at minute" value={b.start} min={0} max={1440} onChange={(v) => onPatch({ start: v ?? 0 })} />
        )}
        <NumberField label="Minutes" value={b.duration} min={1} max={600} onChange={(v) => onPatch({ duration: Math.max(1, v ?? 1) })} />
        <TextField label="Coach" value={b.coach} onChange={(v) => onPatch({ coach: v })} list={listId} />
        <TextField label="Strip / station" value={b.station} onChange={(v) => onPatch({ station: v })} />
      </div>
      <CheckboxField
        label="Runs alongside other activities"
        hint="For intentional overlaps such as individual lessons pulled from bouting — excluded from overlap and total checks."
        checked={b.allowOverlap}
        onChange={(v) => onPatch({ allowOverlap: v })}
      />
      <TextArea label="Objective" rows={2} value={b.objective} onChange={(v) => onPatch({ objective: v })} />
      <LinesField label="Key coaching cues" value={b.cues} onChange={(v) => onPatch({ cues: v })} hint="(one per line — shown as quick chips)" rows={2} />
      <details className="rounded-md border border-slate-200 bg-white px-2 py-1" open={Boolean(b.steps.length || b.setup)}>
        <summary className="py-1 text-sm font-semibold text-gl-blue">Instructions: setup, steps, partners, success</summary>
        <div className="space-y-2 pb-2 pt-1">
          <TextArea label="Setup" rows={2} value={b.setup} onChange={(v) => onPatch({ setup: v })} />
          <CommaField label="Equipment" value={b.equipment} onChange={(v) => onPatch({ equipment: v })} />
          <LinesField label="Steps" value={b.steps} onChange={(v) => onPatch({ steps: v })} rows={4} />
          <div className="grid gap-2 sm:grid-cols-2">
            <TextArea label="Partner roles" rows={2} value={b.partnerRoles} onChange={(v) => onPatch({ partnerRoles: v })} />
            <TextArea label="Rotation" rows={2} value={b.rotation} onChange={(v) => onPatch({ rotation: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TextField label="Sets" value={b.sets} onChange={(v) => onPatch({ sets: v })} />
            <TextField label="Reps" value={b.reps} onChange={(v) => onPatch({ reps: v })} />
            <TextField label="Work" value={b.work} onChange={(v) => onPatch({ work: v })} placeholder="45 s" />
            <TextField label="Rest" value={b.rest} onChange={(v) => onPatch({ rest: v })} placeholder="15 s" />
          </div>
          <TextArea label="Success criteria" rows={2} value={b.successCriteria} onChange={(v) => onPatch({ successCriteria: v })} />
        </div>
      </details>
      <details className="rounded-md border border-slate-200 bg-white px-2 py-1" open={Object.values(b.variations).some(Boolean)}>
        <summary className="py-1 text-sm font-semibold text-gl-blue">Variations (beginner / experienced / easier / harder)</summary>
        <div className="grid gap-2 pb-2 pt-1 sm:grid-cols-2">
          {(["beginner", "experienced", "easier", "harder"] as const).map((k) => (
            <TextArea key={k} label={k[0].toUpperCase() + k.slice(1)} rows={2} value={b.variations[k]} onChange={(v) => onPatch({ variations: { ...b.variations, [k]: v } })} />
          ))}
        </div>
      </details>
      <LinksEditor links={b.links} onChange={(links) => onPatch({ links })} />
      <TextArea label="Notes for fencers" hint="(public)" rows={2} value={b.notes} onChange={(v) => onPatch({ notes: v })} />
      <TextArea label="Private coach note" priv rows={2} value={b.privateNotes} onChange={(v) => onPatch({ privateNotes: v })} placeholder="Never shown on the public calendar." />

      <div className="rounded-md bg-slate-100 px-2 py-2 text-xs text-slate-700">
        {b.source ? (
          <p>
            Copied from library drill <strong>“{b.source.title || "drill"}”</strong> (version {b.source.version}). This is an independent copy — later library edits don&apos;t change it.
          </p>
        ) : (
          <p>Not linked to the drill library.</p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {b.source ? (
            <Button size="sm" onClick={checkLibrary} disabled={libState !== null}>
              {libState === "checking" ? "Checking…" : "Check library for updates"}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => saveToLibrary(false)} disabled={libState !== null}>
            {libState === "saving" ? "Saving…" : "Save as new library drill"}
          </Button>
          {b.privateNotes ? (
            <Button size="sm" variant="ghost" onClick={() => saveToLibrary(true)} disabled={libState !== null}>
              …including private note
            </Button>
          ) : null}
          <Button size="sm" onClick={onReplace}>
            Replace with library drill…
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onDuplicate}>
          Duplicate block
        </Button>
        <Button size="sm" variant="danger" onClick={onRemove}>
          Remove block
        </Button>
      </div>
    </div>
  );
}

export function LinksEditor({ links, onChange }: { links: Array<{ label: string; url: string }>; onChange: (v: Array<{ label: string; url: string }>) => void }) {
  return (
    <fieldset className="rounded-md border border-slate-200 px-2 py-1.5">
      <legend className="px-1 text-xs font-semibold text-slate-700">Video / reference links (YouTube or websites)</legend>
      <div className="space-y-1.5">
        {links.map((l, i) => (
          <div key={i} className="flex flex-wrap gap-1.5">
            <input aria-label="Link label" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Label" value={l.label} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input aria-label="Link URL" className="min-w-0 flex-[2] rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="https://…" inputMode="url" value={l.url} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label="Remove link" onClick={() => onChange(links.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="text-gl-blue" onClick={() => onChange([...links, { label: "", url: "" }])}>
          + Add link
        </Button>
      </div>
    </fieldset>
  );
}
