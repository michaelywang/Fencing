"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { AI_IMPORT_PROMPT } from "@/lib/aiPrompt";
import { startOfWeek, formatWeekRange } from "@/lib/dates";
import { Button, Notice, cx, inputClass } from "@/components/ui";
import { CheckboxField } from "@/components/editor/fields";
import { useCoach, useToast } from "./CoachContext";
import { useTrack } from "./TrackBar";

interface Report {
  dryRun: boolean;
  ok: boolean;
  target: { seasonName: string; trackName: string; trackId: string } | null;
  sharedMode: boolean;
  counts: Record<string, { created: number; updated: number; unchanged: number }>;
  sharedChanges: string[];
  identity: { matchedInTrack: number; sharedWithOtherTracks: number; reusedFromTrash: number; brandNew: number };
  conflicts: string[];
  warnings: string[];
  errors: string[];
  eventDates: string[];
}

export function ImportPage() {
  const toast = useToast();
  const { user } = useCoach();
  const { trackId, track, season } = useTrack();
  const [updateShared, setUpdateShared] = useState(false);
  const [tab, setTab] = useState<"json" | "ics">("json");
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [icsKind, setIcsKind] = useState<"meet" | "tournament" | "other">("meet");
  const [icsTentative, setIcsTentative] = useState(true);
  const [icsInfo, setIcsInfo] = useState<{ count: number; warnings: string[] } | null>(null);

  function parse(): unknown | null {
    try {
      setParseError(null);
      return JSON.parse(text);
    } catch (e) {
      setParseError(`This isn't valid JSON: ${(e as Error).message}`);
      return null;
    }
  }

  async function run(dryRun: boolean) {
    const data = parse();
    if (data === null) return;
    setBusy(true);
    try {
      const r = await api<Report>("/api/import", { body: { data, dryRun, trackId, updateShared } });
      setReport(r);
      if (!dryRun && r.ok) toast({ message: `Imported into ${r.target?.trackName ?? "the track"}. New and updated events are drafts until you publish them.`, tone: "success" });
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Import failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast({ message: "File is too large (max 5 MB).", tone: "error" });
      return;
    }
    const content = await file.text();
    setReport(null);
    if (tab === "ics" || file.name.toLowerCase().endsWith(".ics")) {
      setTab("ics");
      await convertIcs(content);
    } else {
      setText(content);
    }
  }

  async function convertIcs(content: string) {
    setBusy(true);
    try {
      const r = await api<{ data: unknown; warnings: string[]; count: number }>("/api/import/ics", { body: { text: content, kind: icsKind, tentative: icsTentative } });
      setText(JSON.stringify(r.data, null, 2));
      setIcsInfo({ count: r.count, warnings: r.warnings });
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not read that calendar file.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const weeks = report ? [...new Set(report.eventDates.map((d) => startOfWeek(d)))].slice(0, 12) : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section className="space-y-3">
        <h1 className="text-xl font-bold text-slate-900">Import into {track?.name ?? "a track"}</h1>
        <Notice tone="info">
          Target: <strong>{season?.name} / {track?.name}</strong> (use the track switcher above to import into another track). The same file can go into Track A and Track B independently.
          Imports never change the public schedule.
        </Notice>
        <p className="text-sm text-slate-600">
          Bulk-load drills, practice plans, seasons, and meets. Every import is checked first (nothing is saved), then applied in one step — all or nothing. Imported events arrive as <strong>private drafts</strong>; re-importing the same keys updates them instead of duplicating.
        </p>
        <div role="tablist" className="flex gap-1 border-b border-slate-200">
          {(["json", "ics"] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-3 py-1.5 text-sm font-semibold", tab === t ? "border-gl-blue text-gl-blue" : "border-transparent text-slate-600")}>
              {t === "json" ? "Planning file (JSON)" : "Calendar file (.ics)"}
            </button>
          ))}
        </div>
        {tab === "ics" ? (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <p>Upload an iCalendar file (for example a league or athletic-department meet schedule). Each calendar entry becomes an event you can review before importing.</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                Default type
                <select className={cx(inputClass, "w-auto")} value={icsKind} onChange={(e) => setIcsKind(e.target.value as typeof icsKind)}>
                  <option value="meet">Meet</option>
                  <option value="tournament">Tournament</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <CheckboxField label="Mark as tentative" checked={icsTentative} onChange={setIcsTentative} />
            </div>
            <input type="file" accept=".ics,text/calendar" aria-label="Choose .ics file" onChange={(e) => void onFile(e.target.files?.[0])} />
            {icsInfo ? (
              <Notice tone={icsInfo.warnings.length ? "warn" : "success"}>
                Converted {icsInfo.count} event{icsInfo.count === 1 ? "" : "s"} into the planning format below. Review, then check and import.
                {icsInfo.warnings.length ? (
                  <ul className="ml-4 mt-1 list-disc">
                    {icsInfo.warnings.slice(0, 10).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <input type="file" accept=".json,application/json" aria-label="Choose JSON file" onChange={(e) => void onFile(e.target.files?.[0])} />
            <a className="font-semibold text-gl-blue underline" href="/examples/gl-fencing-import-example.json" download>
              Download an example file
            </a>
          </div>
        )}
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">File contents (you can also paste JSON here)</span>
          <textarea className={cx(inputClass, "font-mono text-xs")} rows={14} value={text} onChange={(e) => { setText(e.target.value); setReport(null); }} placeholder='{ "format": "gl-fencing-plan", "version": 1, "drills": [], "events": [] }' />
        </label>
        {parseError ? <Notice tone="error">{parseError}</Notice> : null}
        <CheckboxField
          label="Also update the SHARED drill library, templates, venues and season dates from this file"
          hint="Off (recommended): drills and templates in the file become track-only copies; identical shared ones are reused unchanged. The check lists any shared change it would make."
          checked={updateShared}
          onChange={(v) => {
            setUpdateShared(v);
            setReport(null);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || !text.trim()} onClick={() => run(true)}>
            {busy ? "Checking…" : "1. Check file (nothing is saved)"}
          </Button>
          <Button variant="publish" disabled={busy || !report || !report.ok || !report.dryRun} onClick={() => window.confirm(`Import into ${track?.name}? Events arrive as drafts${updateShared ? "; SHARED library items listed in the check will be changed" : ""}.`) && run(false)}>
            2. Import
          </Button>
        </div>
        {report ? (
          <div className={cx("space-y-2 rounded-lg border p-3 text-sm", report.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50")}>
            <p className="font-bold">{report.dryRun ? (report.ok ? "Check passed — ready to import." : "Check found problems — nothing was saved.") : report.ok ? "Imported." : "Import failed — nothing was saved."}</p>
            {report.target ? (
              <p>
                Target: <strong>{report.target.seasonName} / {report.target.trackName}</strong>
                {report.sharedMode ? " — shared library changes ENABLED" : " — shared library unchanged"}
              </p>
            ) : null}
            <ul className="flex flex-wrap gap-x-4">
              {Object.entries(report.counts)
                .filter(([, v]) => v.created || v.updated || v.unchanged)
                .map(([k, v]) => (
                  <li key={k}>
                    <strong className="capitalize">{k}</strong>: {v.created} new, {v.updated} updated, {v.unchanged} unchanged
                  </li>
                ))}
            </ul>
            {report.identity.sharedWithOtherTracks || report.identity.reusedFromTrash ? (
              <p className="text-slate-700">
                {report.identity.sharedWithOtherTracks ? `${report.identity.sharedWithOtherTracks} new events are this track's version of events another track already has (same keys → same public link). ` : ""}
                {report.identity.reusedFromTrash ? `${report.identity.reusedFromTrash} reuse the identity of events in Trash.` : ""}
              </p>
            ) : null}
            {report.sharedChanges.length ? (
              <div>
                <p className="font-semibold text-slate-800">Shared library / venues / season</p>
                <ul className="ml-4 list-disc">
                  {report.sharedChanges.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.conflicts.length ? (
              <div>
                <p className="font-semibold text-amber-800">Identity notes ({report.conflicts.length})</p>
                <ul className="ml-4 max-h-40 list-disc overflow-y-auto">
                  {report.conflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.errors.length ? (
              <div>
                <p className="font-semibold text-red-800">Errors</p>
                <ul className="ml-4 list-disc text-red-900">
                  {report.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.warnings.length ? (
              <div>
                <p className="font-semibold text-amber-800">Warnings ({report.warnings.length}) — import still allowed</p>
                <ul className="ml-4 max-h-56 list-disc overflow-y-auto text-amber-950">
                  {report.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!report.dryRun && weeks.length ? (
              <p>
                Review and publish:{" "}
                {weeks.map((w) => (
                  <Link key={w} href={`/coach/week?d=${w}&track=${trackId}`} className="mr-3 font-semibold text-gl-blue underline">
                    {formatWeekRange(w)}
                  </Link>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <aside className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h2 className="text-sm font-bold text-slate-900">Turn messy notes into an import file with AI</h2>
          <p className="mt-1 text-sm text-slate-600">Copy this prompt into your AI assistant, paste your notes after it, and upload the JSON it gives back. Check the file here before importing.</p>
          <textarea readOnly className={cx(inputClass, "mt-2 font-mono text-[11px]")} rows={12} value={AI_IMPORT_PROMPT} aria-label="AI prompt" />
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              void navigator.clipboard.writeText(AI_IMPORT_PROMPT).then(
                () => toast({ message: "Prompt copied.", tone: "success" }),
                () => toast({ message: "Copy failed — select the text and copy it manually.", tone: "error" }),
              );
            }}
          >
            Copy prompt
          </Button>
          <p className="mt-2 text-xs text-slate-500">Full format reference: docs/IMPORT_FORMAT.md in the project repository.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <h2 className="text-sm font-bold text-slate-900">Export</h2>
          {user.role === "admin" ? (
            <>
              <p className="mt-1 text-slate-600">
                Planning export (working copies with private notes) in this same format. It is not an image of the public schedule — published backups are kept on the Backups page. Keep it private.
              </p>
              <a className="mt-2 block font-semibold text-gl-blue underline" href={`/api/admin/export?track=${trackId}`}>
                Download {track?.name} (importable into any track)
              </a>
              <a className="mt-1 block font-semibold text-gl-blue underline" href="/api/admin/export">
                Download every season and track
              </a>
            </>
          ) : (
            <p className="mt-1 text-slate-600">Administrators can download a full export.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
