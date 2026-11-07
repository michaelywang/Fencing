"use client";

import { EVENT_KINDS, EVENT_KIND_LABEL, HOME_AWAY, HOME_AWAY_LABEL, INTENSITY_LABEL, type Intensity } from "@/lib/constants";
import { addMinutesToTime } from "@/lib/dates";
import { weaponSummary } from "@/lib/practice";
import type { EventDoc, MeetDetails } from "@/lib/schemas";
import { WEAPONS, WEAPON_LABEL } from "@/lib/weapons";
import { useCoach } from "@/components/coach/CoachContext";
import { cx } from "@/components/ui";
import { FieldLabel, LinesField, NumberField, SelectField, TextArea, TextField, TimeField } from "./fields";
import { LinksEditor } from "./PlanEditor";

type Update = (fn: (d: EventDoc) => EventDoc) => void;

const emptyMeet = (): NonNullable<MeetDetails> => ({ opponent: "", homeAway: null, reportTime: null, busDepart: null, busReturn: null, address: "", details: "" });

export function DetailsForm({ doc, update }: { doc: EventDoc; update: Update }) {
  const { locations, coachNames } = useCoach();
  const set = <K extends keyof EventDoc>(key: K, value: EventDoc[K]) => update((d) => ({ ...d, [key]: value }));
  const isCompetition = doc.kind === "meet" || doc.kind === "tournament";
  const meet = doc.meet ?? emptyMeet();
  const setMeet = (patch: Partial<NonNullable<MeetDetails>>) => update((d) => ({ ...d, meet: { ...(d.meet ?? emptyMeet()), ...patch } }));
  const activeLocations = locations.filter((l) => !l.archivedAt || l.id === doc.locationId);

  return (
    <div className="space-y-4">
      <datalist id="coach-names">
        {coachNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Type" value={doc.kind} onChange={(v) => set("kind", v)} options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABEL[k] }))} />
        <TextField label="Title" value={doc.title} onChange={(v) => set("title", v)} placeholder={isCompetition ? "e.g. Meet vs. Opponent HS" : "e.g. Practice"} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextField label="Date" type="date" value={doc.date} onChange={(v) => v && set("date", v)} />
        <TimeField
          label="Start"
          value={doc.startTime}
          onChange={(v) =>
            update((d) => ({
              ...d,
              startTime: v,
              endTime: v && !d.endTime && (d.kind === "practice" || d.kind === "recovery") ? addMinutesToTime(v, d.targetMinutes) : v ? d.endTime : null,
            }))
          }
        />
        <TimeField label="End" value={doc.endTime} onChange={(v) => set("endTime", v)} />
        <fieldset>
          <legend className="mb-0.5 text-xs font-semibold text-slate-700">Status</legend>
          <div className="flex gap-1">
            {(["confirmed", "tentative"] as const).map((c) => (
              <label key={c} className={cx("touch-target flex flex-1 items-center justify-center rounded-md border px-2 py-1.5 text-sm", doc.confirmation === c ? "border-gl-blue bg-gl-blue-soft font-semibold" : "border-slate-300 bg-white")}>
                <input type="radio" className="sr-only" name="confirmation" checked={doc.confirmation === c} onChange={() => set("confirmation", c)} />
                {c === "confirmed" ? "Confirmed" : "Tentative"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Location"
          value={doc.locationId ?? ""}
          onChange={(v) => set("locationId", v || null)}
          options={[{ value: "", label: "Other / away venue (type below)" }, ...activeLocations.map((l) => ({ value: l.id, label: l.name }))]}
        />
        {!doc.locationId ? <TextField label="Venue / address" value={doc.locationNote} onChange={(v) => set("locationNote", v)} placeholder="Away school name and address" /> : null}
      </div>

      {isCompetition || doc.meet ? (
        <fieldset className="space-y-3 rounded-lg border border-gl-red/30 bg-gl-red-soft/50 p-3">
          <legend className="px-1 text-sm font-bold text-gl-red-dark">Competition logistics</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Opponent(s)" value={meet.opponent} onChange={(v) => setMeet({ opponent: v })} />
            <SelectField
              label="Home / away"
              value={meet.homeAway ?? ""}
              onChange={(v) => setMeet({ homeAway: (v || null) as typeof meet.homeAway })}
              options={[{ value: "", label: "—" }, ...HOME_AWAY.map((h) => ({ value: h, label: HOME_AWAY_LABEL[h] }))]}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <TimeField label="Report time" value={meet.reportTime} onChange={(v) => setMeet({ reportTime: v })} />
            <TimeField label="Bus departs" value={meet.busDepart} onChange={(v) => setMeet({ busDepart: v })} />
            <TimeField label="Bus returns" value={meet.busReturn} onChange={(v) => setMeet({ busReturn: v })} />
          </div>
          <TextField label="Venue address" value={meet.address} onChange={(v) => setMeet({ address: v })} />
          <TextArea label="Details for fencers" hint="(public)" rows={2} value={meet.details} onChange={(v) => setMeet({ details: v })} />
        </fieldset>
      ) : (
        <button type="button" className="text-sm font-semibold text-gl-blue underline" onClick={() => setMeet({})}>
          + Add bus / report times
        </button>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <TextField label="Theme" value={doc.theme} onChange={(v) => set("theme", v)} placeholder="e.g. Distance and footwork foundations" />
        <NumberField label="Target minutes" value={doc.targetMinutes} min={0} max={720} onChange={(v) => set("targetMinutes", v ?? 0)} className="w-32" />
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-semibold text-slate-700">Intensity</legend>
        <div className="flex flex-wrap gap-1">
          {([null, 1, 2, 3, 4, 5] as const).map((lvl) => (
            <label key={String(lvl)} className={cx("touch-target flex items-center rounded-md border px-2.5 py-1.5 text-sm", doc.intensity === lvl ? "border-gl-blue bg-gl-blue-soft font-semibold" : "border-slate-300 bg-white")}>
              <input type="radio" className="sr-only" name="intensity" checked={doc.intensity === lvl} onChange={() => set("intensity", lvl)} />
              {lvl === null ? "None" : `${lvl} · ${INTENSITY_LABEL[lvl as Intensity]}`}
            </label>
          ))}
        </div>
      </fieldset>
      <LinesField label="Objectives" value={doc.objectives} onChange={(v) => set("objectives", v)} rows={3} />
      <TextArea label="Announcement" hint="(public — shown prominently to fencers)" rows={3} value={doc.announcement} onChange={(v) => set("announcement", v)} placeholder="e.g. Bring full uniform and a water bottle." />
      <LinesField label="Equipment to bring / set up" value={doc.equipment} onChange={(v) => set("equipment", v)} rows={2} />

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-800">Calendar card summaries</legend>
        <p className="mb-2 text-xs text-slate-600">Short per-weapon focus shown on calendar cards. Leave blank to use the first main drill automatically.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {WEAPONS.map((w) => (
            <TextField key={w} label={WEAPON_LABEL[w]} value={doc.weaponSummaries[w]} onChange={(v) => set("weaponSummaries", { ...doc.weaponSummaries, [w]: v })} placeholder={weaponSummary(w, {}, doc.blocks) || "—"} />
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-800">Coach assignments</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {(["shared", ...WEAPONS] as const).map((k) => (
            <TextField key={k} label={k === "shared" ? "Shared / lead" : WEAPON_LABEL[k]} value={doc.coachAssignments[k]} onChange={(v) => set("coachAssignments", { ...doc.coachAssignments, [k]: v })} list="coach-names" />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Beginners" hint="(public)" rows={2} value={doc.levelNotes.beginner} onChange={(v) => set("levelNotes", { ...doc.levelNotes, beginner: v })} />
        <TextArea label="Experienced fencers" hint="(public)" rows={2} value={doc.levelNotes.experienced} onChange={(v) => set("levelNotes", { ...doc.levelNotes, experienced: v })} />
      </div>
      <LinksEditor links={doc.links} onChange={(v) => set("links", v)} />
    </div>
  );
}

export function NotesForm({ doc, update }: { doc: EventDoc; update: Update }) {
  return (
    <div className="space-y-4">
      <p className="rounded-md border border-dashed border-slate-400 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        🔒 Everything on this tab is <strong>private to coaches</strong>. It is never published, previewed for students, or copied to templates unless you choose to. Keep medical details, evaluations and lineup deliberations here — or better, out of this app.
      </p>
      <TextArea label="Coaching notes (plan)" priv rows={6} value={doc.privateNotes} onChange={(v) => update((d) => ({ ...d, privateNotes: v }))} />
      <div>
        <FieldLabel htmlFor="completed-notes" priv>
          Completed notes — what actually happened
        </FieldLabel>
        <textarea
          id="completed-notes"
          rows={6}
          className="block w-full rounded-md border border-dashed border-slate-500 bg-slate-50 px-2.5 py-1.5 text-sm"
          value={doc.completedNotes}
          onChange={(e) => update((d) => ({ ...d, completedNotes: e.target.value }))}
          placeholder="After practice: what ran long, what to repeat, what to change next time."
        />
      </div>
    </div>
  );
}
