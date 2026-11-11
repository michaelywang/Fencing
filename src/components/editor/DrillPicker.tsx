"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { blockFromDrill, type LibraryDrill } from "@/lib/drills";
import { DRILL_LEVEL_LABEL, BLOCK_CATEGORY_LABEL } from "@/lib/constants";
import type { Block, EventDoc } from "@/lib/schemas";
import { LANE_LABEL, WEAPONS, type Lane, type Weapon } from "@/lib/weapons";
import { Modal } from "@/components/coach/CoachContext";
import { useTrack } from "@/components/coach/TrackBar";
import { WeaponTag } from "@/components/badges";
import { Button, Notice, Spinner, cx, inputClass } from "@/components/ui";
import { laneEnd } from "./PlanEditor";

/**
 * Search the drill library and insert a drill as an EDITABLE SNAPSHOT
 * (or replace an existing block's content).
 */
export function DrillPicker({
  open,
  mode,
  doc,
  onClose,
  onAdd,
  onReplace,
}: {
  open: boolean;
  mode: "add" | "replace";
  doc: EventDoc;
  onClose: () => void;
  onAdd: (blocks: Block[]) => void;
  onReplace: (drill: LibraryDrill) => void;
}) {
  const { trackId } = useTrack();
  const [q, setQ] = useState("");
  const [weapon, setWeapon] = useState<Weapon | "">("");
  const [level, setLevel] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [drills, setDrills] = useState<LibraryDrill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LibraryDrill | null>(null);
  const [lane, setLane] = useState<Lane>("shared");
  const [duration, setDuration] = useState<number>(15);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (weapon) params.set("weapon", weapon);
    if (level) params.set("level", level);
    if (maxDuration) params.set("maxDuration", maxDuration);
    if (trackId) params.set("track", trackId); // shared library + this track's own drills
    const t = window.setTimeout(() => {
      api<{ drills: LibraryDrill[] }>(`/api/drills?${params}`, { signal: ctrl.signal })
        .then((r) => {
          setDrills(r.drills);
          setError(null);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setError(e instanceof ApiError ? e.message : "Could not load the library.");
        });
    }, 200);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [open, q, weapon, level, maxDuration, trackId]);

  function choose(d: LibraryDrill) {
    if (mode === "replace") {
      onReplace(d);
      return;
    }
    setSelected(d);
    setDuration(d.durationMin ?? 15);
    setLane(d.weapons.length === 1 ? d.weapons[0] : d.weapons.length === 0 ? "shared" : d.weapons[0]);
  }

  const start = useMemo(() => laneEnd(doc.blocks, lane), [doc.blocks, lane]);

  function insert(perWeapon: boolean) {
    if (!selected) return;
    if (perWeapon) {
      const blocks = WEAPONS.filter((w) => selected.weapons.length === 0 || selected.weapons.includes(w)).map((w) =>
        blockFromDrill(selected, { scope: "weapon", weapons: [w], start: laneEnd(doc.blocks, w), duration }),
      );
      onAdd(blocks);
    } else {
      onAdd([blockFromDrill(selected, { scope: lane === "shared" ? "shared" : "weapon", weapons: lane === "shared" ? [] : [lane], start, duration })]);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === "replace" ? "Replace with a library drill" : "Add a drill from the library"} wide>
      {selected && mode === "add" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Adding <strong>{selected.title}</strong>. It is copied into this practice as an editable snapshot — later library edits won&apos;t change it.
          </p>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-slate-700">Lane</legend>
            <div className="flex flex-wrap gap-2">
              {(["shared", ...WEAPONS] as Lane[]).map((l) => (
                <label key={l} className={cx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm", lane === l ? "border-gl-blue bg-gl-blue-soft" : "border-slate-300")}>
                  <input type="radio" name="lane" checked={lane === l} onChange={() => setLane(l)} />
                  {LANE_LABEL[l]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-0.5 block text-xs font-semibold text-slate-700">Minutes</span>
              <input type="number" min={1} max={600} className={cx(inputClass, "w-24")} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <p className="pb-2 text-sm text-slate-600">Starts at minute {start} (right after the last {LANE_LABEL[lane]} activity). Adjust afterwards if needed.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => insert(false)}>
              Add to {LANE_LABEL[lane]}
            </Button>
            {selected.weapons.length !== 1 ? (
              <Button onClick={() => insert(true)} title="Creates one parallel copy per weapon group">
                Add a parallel copy for each weapon
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setSelected(null)}>
              ← Back to results
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <input aria-label="Search drills" className={inputClass} placeholder="Search title, objective, tags, skills…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <select aria-label="Weapon" className={inputClass} value={weapon} onChange={(e) => setWeapon(e.target.value as Weapon | "")}>
              <option value="">Any weapon</option>
              {WEAPONS.map((w) => (
                <option key={w} value={w}>
                  {LANE_LABEL[w]}
                </option>
              ))}
            </select>
            <select aria-label="Level" className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Any level</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="experienced">Experienced</option>
            </select>
            <select aria-label="Maximum duration" className={inputClass} value={maxDuration} onChange={(e) => setMaxDuration(e.target.value)}>
              <option value="">Any length</option>
              <option value="10">≤ 10 min</option>
              <option value="15">≤ 15 min</option>
              <option value="20">≤ 20 min</option>
              <option value="30">≤ 30 min</option>
            </select>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {drills === null && !error ? <Spinner label="Loading drills" /> : null}
          {drills && drills.length === 0 ? <p className="text-sm text-slate-600">No drills match. Create drills in the Drill library page.</p> : null}
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {drills?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{d.title}</p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                    {d.weapons.length ? d.weapons.map((w) => <WeaponTag key={w} weapon={w} />) : <span className="rounded bg-shared px-1 font-bold text-white">All weapons</span>}
                    <span>· {DRILL_LEVEL_LABEL[d.level]}</span>
                    {d.durationMin ? <span>· {d.durationMin} min</span> : null}
                    <span>· {BLOCK_CATEGORY_LABEL[d.category]}</span>
                    {d.skills.length ? <span>· {d.skills.join(", ")}</span> : null}
                  </p>
                  {d.details.objective ? <p className="line-clamp-1 text-sm text-slate-700">{d.details.objective}</p> : null}
                </div>
                <Button size="sm" variant={mode === "replace" ? "primary" : "secondary"} onClick={() => choose(d)}>
                  {mode === "replace" ? "Use this drill" : "Choose"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
