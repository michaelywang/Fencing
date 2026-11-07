"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { BLOCK_CATEGORIES, BLOCK_CATEGORY_LABEL, DRILL_LEVELS, DRILL_LEVEL_LABEL, SUGGESTED_SKILLS } from "@/lib/constants";
import type { LibraryDrill } from "@/lib/drills";
import { emptyDrillDetails, type DrillDetails } from "@/lib/schemas";
import { WEAPONS, WEAPON_LABEL, type Weapon } from "@/lib/weapons";
import { WeaponTag } from "@/components/badges";
import { Button, EmptyState, Notice, Spinner, cx, inputClass } from "@/components/ui";
import { CommaField, LinesField, NumberField, SelectField, TextArea, TextField } from "@/components/editor/fields";
import { LinksEditor } from "@/components/editor/PlanEditor";
import { Modal, useToast } from "./CoachContext";

type DrillRow = LibraryDrill & { deletedAt: string | null; externalRef: string | null };
interface Facets {
  skills: string[];
  equipment: string[];
  tags: string[];
}

interface Draft {
  title: string;
  weapons: Weapon[];
  skills: string[];
  level: LibraryDrill["level"];
  durationMin: number | null;
  equipment: string[];
  tags: string[];
  category: LibraryDrill["category"];
  details: DrillDetails;
  coachNotes: string;
}

const blankDraft = (): Draft => ({ title: "", weapons: [], skills: [], level: "all", durationMin: 15, equipment: [], tags: [], category: "technical", details: emptyDrillDetails(), coachNotes: "" });
const toDraft = (d: LibraryDrill): Draft => ({ title: d.title, weapons: d.weapons, skills: d.skills, level: d.level, durationMin: d.durationMin, equipment: d.equipment, tags: d.tags, category: d.category, details: d.details, coachNotes: d.coachNotes });

export function DrillLibrary() {
  const toast = useToast();
  const [filters, setFilters] = useState({ q: "", weapon: "", skill: "", level: "", maxDuration: "", equipment: "", tag: "" });
  const [drills, setDrills] = useState<DrillRow[] | null>(null);
  const [facets, setFacets] = useState<Facets>({ skills: [], equipment: [], tags: [] });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ drill: DrillRow | null } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    api<{ drills: DrillRow[] }>(`/api/drills?${p}`)
      .then((r) => {
        setDrills(r.drills);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the library."));
  }, [filters]);

  useEffect(() => {
    const t = window.setTimeout(load, 200);
    return () => window.clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api<Facets>("/api/drills/facets").then(setFacets).catch(() => {});
  }, [drills?.length]);

  async function remove(d: DrillRow) {
    try {
      await api(`/api/drills/${d.id}`, { method: "DELETE" });
      load();
      toast({
        message: `Deleted “${d.title}”. Practices that already use it keep their copies.`,
        action: { label: "Undo", onClick: () => void api(`/api/drills/${d.id}/restore`, { body: {} }).then(load) },
      });
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Delete failed.", tone: "error" });
    }
  }

  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold text-slate-900">Drill library</h1>
        <Button variant="primary" onClick={() => setEditing({ drill: null })}>
          + New drill
        </Button>
      </div>
      <p className="text-sm text-slate-600">
        Build drills once, then insert them into practices from the editor (<strong>+ From drill library</strong>). Each insert is an independent, editable copy — editing a drill here never changes practices that already use it.
      </p>
      <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-2 lg:grid-cols-7">
        <input aria-label="Search" className={cx(inputClass, "lg:col-span-2")} placeholder="Search drills…" value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        <FilterSelect label="Weapon" value={filters.weapon} onChange={set("weapon")} options={WEAPONS.map((w) => [w, WEAPON_LABEL[w]])} />
        <FilterSelect label="Skill" value={filters.skill} onChange={set("skill")} options={facets.skills.map((s) => [s, s])} />
        <FilterSelect label="Level" value={filters.level} onChange={set("level")} options={[["beginner", "Beginner"], ["intermediate", "Intermediate"], ["experienced", "Experienced"]]} />
        <FilterSelect label="Max length" value={filters.maxDuration} onChange={set("maxDuration")} options={[["10", "≤ 10 min"], ["15", "≤ 15 min"], ["20", "≤ 20 min"], ["30", "≤ 30 min"], ["45", "≤ 45 min"]]} />
        <FilterSelect label="Equipment" value={filters.equipment} onChange={set("equipment")} options={facets.equipment.map((s) => [s, s])} />
        <FilterSelect label="Tag" value={filters.tag} onChange={set("tag")} options={facets.tags.map((s) => [s, s])} />
        {anyFilter ? (
          <Button size="sm" variant="ghost" onClick={() => setFilters({ q: "", weapon: "", skill: "", level: "", maxDuration: "", equipment: "", tag: "" })}>
            Clear filters
          </Button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {drills === null && !error ? <Spinner label="Loading drills" /> : null}
      {drills && drills.length === 0 ? (
        <EmptyState title={anyFilter ? "No drills match these filters" : "The library is empty"} action={<Button variant="primary" onClick={() => setEditing({ drill: null })}>+ New drill</Button>}>
          {anyFilter ? "Try clearing a filter." : "Add drills here, or import a whole library from a file on the Import page."}
        </EmptyState>
      ) : null}
      <ul className="grid gap-2 lg:grid-cols-2">
        {drills?.map((d) => (
          <li key={d.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-900">{d.title}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-600">
                  {d.weapons.length ? d.weapons.map((w) => <WeaponTag key={w} weapon={w} />) : <span className="rounded bg-shared px-1 font-bold text-white">All weapons</span>}
                  <span>· {DRILL_LEVEL_LABEL[d.level]}</span>
                  {d.durationMin ? <span>· {d.durationMin} min</span> : null}
                  <span>· {BLOCK_CATEGORY_LABEL[d.category]}</span>
                  {d.isDemo ? <span className="rounded bg-fuchsia-100 px-1 font-semibold text-fuchsia-900">Demo</span> : null}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setExpanded(expanded === d.id ? null : d.id)} aria-expanded={expanded === d.id}>
                  {expanded === d.id ? "Hide" : "Details"}
                </Button>
                <Button size="sm" onClick={() => setEditing({ drill: d })}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}>
                  ✕
                </Button>
              </div>
            </div>
            {d.details.objective ? <p className="mt-1 text-sm text-slate-700">{d.details.objective}</p> : null}
            {d.skills.length || d.tags.length ? (
              <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                {d.skills.map((s) => (
                  <span key={`s-${s}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    {s}
                  </span>
                ))}
                {d.tags.map((t) => (
                  <span key={`t-${t}`} className="rounded-full border border-slate-300 px-2 py-0.5 text-slate-600">
                    #{t}
                  </span>
                ))}
              </p>
            ) : null}
            {expanded === d.id ? (
              <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-sm text-slate-800">
                {d.details.cues.length ? <p><strong>Cues:</strong> {d.details.cues.join(" · ")}</p> : null}
                {d.details.steps.length ? (
                  <ol className="ml-5 list-decimal">
                    {d.details.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                ) : null}
                {d.details.variations.beginner ? <p><strong>Beginner:</strong> {d.details.variations.beginner}</p> : null}
                {d.details.variations.experienced ? <p><strong>Experienced:</strong> {d.details.variations.experienced}</p> : null}
                {d.equipment.length ? <p><strong>Equipment:</strong> {d.equipment.join(", ")}</p> : null}
                {d.coachNotes ? <p className="rounded border border-dashed border-slate-400 bg-slate-50 px-2 py-1">🔒 {d.coachNotes}</p> : null}
                <p className="text-xs text-slate-500">Version {d.version}{d.externalRef ? ` · import key ${d.externalRef}` : ""}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? <DrillForm drill={editing.drill} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select aria-label={label} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: any</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function DrillForm({ drill, onClose, onSaved }: { drill: DrillRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(drill ? toDraft(drill) : blankDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setDetails = (patch: Partial<DrillDetails>) => setD((x) => ({ ...x, details: { ...x.details, ...patch } }));

  async function save() {
    setBusy(true);
    setError(null);
    const payload = { ...d, details: { ...d.details, links: d.details.links.filter((l) => l.url.trim()) } };
    try {
      if (drill) await api(`/api/drills/${drill.id}`, { method: "PUT", body: { baseVersion: drill.version, drill: payload } });
      else await api("/api/drills", { body: { drill: payload } });
      toast({ message: drill ? `Saved “${d.title}” (scheduled practices keep their own copies).` : `Added “${d.title}” to the library.`, tone: "success" });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? (e.isConflict ? "Another coach edited this drill since you opened it. Close and reopen to see their version (copy your changes first)." : e.message) : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={drill ? `Edit drill: ${drill.title}` : "New library drill"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !d.title.trim()}>
            {busy ? "Saving…" : "Save drill"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
          <TextField label="Title" value={d.title} onChange={(v) => setD({ ...d, title: v })} />
          <SelectField label="Category" value={d.category} onChange={(v) => setD({ ...d, category: v })} options={BLOCK_CATEGORIES.map((c) => ({ value: c, label: BLOCK_CATEGORY_LABEL[c] }))} />
        </div>
        <fieldset className="rounded-md border border-slate-200 px-2 py-1.5">
          <legend className="px-1 text-xs font-semibold text-slate-700">Weapons (none checked = all weapons / shared)</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {WEAPONS.map((w) => (
              <label key={w} className="flex items-center gap-1.5">
                <input type="checkbox" checked={d.weapons.includes(w)} onChange={(e) => setD({ ...d, weapons: e.target.checked ? [...d.weapons, w] : d.weapons.filter((x) => x !== w) })} />
                {WEAPON_LABEL[w]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SelectField label="Level" value={d.level} onChange={(v) => setD({ ...d, level: v })} options={DRILL_LEVELS.map((l) => ({ value: l, label: DRILL_LEVEL_LABEL[l] }))} />
          <NumberField label="Typical minutes" value={d.durationMin} min={1} max={600} onChange={(v) => setD({ ...d, durationMin: v })} />
          <CommaField label="Skills / objectives" value={d.skills} onChange={(v) => setD({ ...d, skills: v })} placeholder={SUGGESTED_SKILLS.slice(0, 3).join(", ")} className="col-span-2" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <CommaField label="Equipment" value={d.equipment} onChange={(v) => setD({ ...d, equipment: v, details: { ...d.details, equipment: v } })} />
          <CommaField label="Tags" value={d.tags} onChange={(v) => setD({ ...d, tags: v })} />
        </div>
        <TextArea label="Objective" rows={2} value={d.details.objective} onChange={(v) => setDetails({ objective: v })} />
        <TextArea label="Setup" rows={2} value={d.details.setup} onChange={(v) => setDetails({ setup: v })} />
        <LinesField label="Steps" value={d.details.steps} onChange={(v) => setDetails({ steps: v })} rows={4} />
        <div className="grid gap-2 sm:grid-cols-2">
          <TextArea label="Partner roles" rows={2} value={d.details.partnerRoles} onChange={(v) => setDetails({ partnerRoles: v })} />
          <TextArea label="Rotation" rows={2} value={d.details.rotation} onChange={(v) => setDetails({ rotation: v })} />
        </div>
        <LinesField label="Coaching cues" value={d.details.cues} onChange={(v) => setDetails({ cues: v })} rows={2} />
        <TextArea label="Success criteria" rows={2} value={d.details.successCriteria} onChange={(v) => setDetails({ successCriteria: v })} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TextField label="Sets" value={d.details.sets} onChange={(v) => setDetails({ sets: v })} />
          <TextField label="Reps" value={d.details.reps} onChange={(v) => setDetails({ reps: v })} />
          <TextField label="Work" value={d.details.work} onChange={(v) => setDetails({ work: v })} />
          <TextField label="Rest" value={d.details.rest} onChange={(v) => setDetails({ rest: v })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["beginner", "experienced", "easier", "harder"] as const).map((k) => (
            <TextArea key={k} label={`${k[0].toUpperCase()}${k.slice(1)} variation`} rows={2} value={d.details.variations[k]} onChange={(v) => setDetails({ variations: { ...d.details.variations, [k]: v } })} />
          ))}
        </div>
        <LinksEditor links={d.details.links} onChange={(links) => setDetails({ links })} />
        <TextArea label="Coach-only notes" priv rows={2} value={d.coachNotes} onChange={(v) => setD({ ...d, coachNotes: v })} placeholder="Copied into a practice's private notes only if you choose to." />
      </div>
    </Modal>
  );
}
