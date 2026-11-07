"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatTimestamp } from "@/lib/dates";
import { Button, Notice, Spinner, cx, inputClass } from "@/components/ui";
import { CheckboxField, NumberField, SelectField, TextArea, TextField, TimeField } from "@/components/editor/fields";
import { useCoach, useToast } from "./CoachContext";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "admin" | "coach";
  lastLoginAt: string | null;
  disabledAt: string | null;
}
interface InviteRow {
  id: string;
  email: string;
  role: "admin" | "coach" | null;
  createdAt: string;
  expiresAt: string;
}
interface Settings {
  teamName: string;
  shortName: string;
  timezone: string;
  defaultPracticeMinutes: number;
  defaultPracticeStart: string;
  defaultPracticeLocationId: string | null;
  defaultMeetLocationId: string | null;
  publicIntro: string;
  showCoachNamesPublicly: boolean;
}
interface Loc {
  id: string;
  name: string;
  shortName: string;
  address: string;
  kind: "practice" | "meet" | "both" | "away";
  notes: string;
  sortOrder: number;
  archivedAt: string | null;
}

function CopyLink({ url, note }: { url: string; note: string }) {
  const toast = useToast();
  return (
    <div className="space-y-1 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm">
      <p className="font-semibold text-emerald-900">{note}</p>
      <div className="flex gap-2">
        <input readOnly className={cx(inputClass, "font-mono text-xs")} value={url} aria-label="Link" onFocus={(e) => e.target.select()} />
        <Button size="sm" onClick={() => void navigator.clipboard.writeText(url).then(() => toast({ message: "Link copied.", tone: "success" }))}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-slate-600">Send it privately (text or email). It works once and expires.</p>
    </div>
  );
}

export function AdminPage() {
  const { user, settings: ctxSettings } = useCoach();
  if (user.role !== "admin") {
    return <Notice tone="warn">Administrators only. Ask your head coach if you need access.</Notice>;
  }
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Admin</h1>
      <Coaches />
      <TeamSettings timezoneHint={ctxSettings.timezone} />
      <Locations />
      <DataSection />
    </div>
  );
}

function Coaches() {
  const toast = useToast();
  const { user: me, settings } = useCoach();
  const [data, setData] = useState<{ users: UserRow[]; invites: InviteRow[]; emailEnabled: boolean } | null>(null);
  const [invite, setInvite] = useState({ email: "", role: "coach" as "coach" | "admin", name: "" });
  const [link, setLink] = useState<{ url: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ users: UserRow[]; invites: InviteRow[]; emailEnabled: boolean }>("/api/admin/users").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load coaches."));
  }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    try {
      await fn();
      if (ok) toast({ message: ok, tone: "success" });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" aria-labelledby="coaches-h">
      <h2 id="coaches-h" className="text-lg font-bold text-slate-900">Coaches</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data ? <Spinner label="Loading coaches" /> : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-1 pr-2">Name</th>
                  <th className="pr-2">Email (username)</th>
                  <th className="pr-2">Role</th>
                  <th className="pr-2">Last sign-in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.users.map((u) => (
                  <tr key={u.id} className={cx(u.disabledAt && "opacity-60")}>
                    <td className="py-1.5 pr-2 font-semibold">{u.name}{u.id === me.id ? " (you)" : ""}</td>
                    <td className="pr-2">{u.email}</td>
                    <td className="pr-2">{u.disabledAt ? "Disabled" : u.role === "admin" ? "Administrator" : "Coach"}</td>
                    <td className="pr-2 text-xs">{u.lastLoginAt ? formatTimestamp(u.lastLoginAt, settings.timezone) : "never"}</td>
                    <td className="flex flex-wrap gap-1 py-1">
                      <Button size="sm" onClick={() => act(async () => { const r = await api<{ url: string; emailed: boolean }>(`/api/admin/users/${u.id}/reset-link`, { body: { email: data.emailEnabled } }); setLink({ url: r.url, note: r.emailed ? `Reset link emailed to ${u.email} (also shown here).` : `Password reset link for ${u.name} (valid 72 hours):` }); })}>
                        Reset link
                      </Button>
                      {u.id !== me.id ? (
                        <>
                          <Button size="sm" onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role: u.role === "admin" ? "coach" : "admin" } }), "Role updated.")}>
                            Make {u.role === "admin" ? "coach" : "admin"}
                          </Button>
                          <Button size="sm" variant={u.disabledAt ? "secondary" : "danger"} onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { disabled: !u.disabledAt } }), u.disabledAt ? "Account enabled." : "Account disabled and signed out everywhere.")}>
                            {u.disabledAt ? "Enable" : "Disable"}
                          </Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.invites.length ? (
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Pending invites</h3>
              <ul className="text-sm">
                {data.invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 py-1">
                    <span className="flex-1">
                      {i.email} · {i.role === "admin" ? "Administrator" : "Coach"} · expires {formatTimestamp(i.expiresAt, settings.timezone)}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/admin/invites/${i.id}`, { method: "DELETE" }), "Invite revoked.")}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <form
            className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const r = await api<{ url: string; emailed: boolean; email: string }>("/api/admin/invites", { body: invite });
                setLink({ url: r.url, note: r.emailed ? `Invite emailed to ${r.email} (link also shown here).` : `Invite link for ${r.email} (valid 7 days):` });
                setInvite({ email: "", role: "coach", name: "" });
              });
            }}
          >
            <input aria-label="Coach email" type="email" required className={inputClass} placeholder="coach@any-domain.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <input aria-label="Coach name (optional)" className={inputClass} placeholder="Name (optional)" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            <select aria-label="Role" className={inputClass} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as "coach" | "admin" })}>
              <option value="coach">Coach / editor</option>
              <option value="admin">Administrator</option>
            </select>
            <Button type="submit" variant="primary">
              Create invite
            </Button>
          </form>
          {link ? <CopyLink url={link.url} note={link.note} /> : null}
          <p className="text-xs text-slate-500">
            {data.emailEnabled ? "Email is configured: invites and reset links are also emailed." : "Email is not configured, so copy links and send them yourself. (Optional SMTP setup: docs/DEPLOYMENT.md.)"}
          </p>
        </>
      ) : null}
    </section>
  );
}

function TeamSettings({ timezoneHint }: { timezoneHint: string }) {
  const router = useRouter();
  const toast = useToast();
  const { locations } = useCoach();
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ settings: Settings }>("/api/admin/settings").then((r) => setS(r.settings)).catch(() => setError("Could not load settings."));
  }, []);
  if (!s) return error ? <Notice tone="error">{error}</Notice> : <Spinner label="Loading settings" />;
  const locOptions = [{ value: "", label: "— none —" }, ...locations.filter((l) => !l.archivedAt).map((l) => ({ value: l.id, label: l.name }))];
  async function save() {
    setError(null);
    try {
      await api("/api/admin/settings", { method: "PUT", body: s });
      toast({ message: "Settings saved.", tone: "success" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" aria-labelledby="settings-h">
      <h2 id="settings-h" className="text-lg font-bold text-slate-900">Team settings</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Team name" value={s.teamName} onChange={(v) => setS({ ...s, teamName: v })} />
        <TextField label="Short name" value={s.shortName} onChange={(v) => setS({ ...s, shortName: v })} />
        <TextField label="Time zone" hint={`(IANA, currently ${timezoneHint})`} value={s.timezone} onChange={(v) => setS({ ...s, timezone: v })} />
        <NumberField label="Default practice minutes" value={s.defaultPracticeMinutes} min={15} max={600} onChange={(v) => setS({ ...s, defaultPracticeMinutes: v ?? 150 })} />
        <TimeField label="Default practice start" value={s.defaultPracticeStart} allowEmpty={false} onChange={(v) => v && setS({ ...s, defaultPracticeStart: v })} />
        <div />
        <SelectField label="Default practice location" value={s.defaultPracticeLocationId ?? ""} onChange={(v) => setS({ ...s, defaultPracticeLocationId: v || null })} options={locOptions} />
        <SelectField label="Default home-meet location" value={s.defaultMeetLocationId ?? ""} onChange={(v) => setS({ ...s, defaultMeetLocationId: v || null })} options={locOptions} />
      </div>
      <TextArea label="Public welcome text" hint="(shown on the team home page)" rows={2} value={s.publicIntro} onChange={(v) => setS({ ...s, publicIntro: v })} />
      <CheckboxField label="Show coach names on the public site" hint="Takes effect for events the next time they are published." checked={s.showCoachNamesPublicly} onChange={(v) => setS({ ...s, showCoachNamesPublicly: v })} />
      <Button variant="primary" onClick={save}>
        Save settings
      </Button>
    </section>
  );
}

function Locations() {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<Loc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ locations: Loc[] }>("/api/locations?archived=1").then((r) => setList(r.locations)).catch(() => setError("Could not load locations."));
  }, []);
  useEffect(load, [load]);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try {
      await fn();
      toast({ message: ok, tone: "success" });
      load();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" aria-labelledby="loc-h">
      <h2 id="loc-h" className="text-lg font-bold text-slate-900">Locations</h2>
      <p className="text-sm text-slate-600">Practices default to the practice facility, home meets to the meet facility. Away venues can be typed per event or saved here.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!list ? <Spinner label="Loading locations" /> : null}
      <ul className="space-y-2">
        {list?.map((l) => (
          <LocationRow key={l.id} loc={l} onSave={(v) => act(() => api(`/api/locations/${l.id}`, { method: "PUT", body: v }), "Location saved.")} onArchive={(archived) => act(() => api(`/api/locations/${l.id}`, { method: "PATCH", body: { archived } }), archived ? "Location archived." : "Location restored.")} />
        ))}
      </ul>
      <Button size="sm" onClick={() => act(() => api("/api/locations", { body: { name: "New venue", shortName: "New venue", kind: "away" } }), "Location added — edit its details below.")}>
        + Add location
      </Button>
    </section>
  );
}

function LocationRow({ loc, onSave, onArchive }: { loc: Loc; onSave: (v: Omit<Loc, "id" | "archivedAt">) => void; onArchive: (archived: boolean) => void }) {
  const [v, setV] = useState({ name: loc.name, shortName: loc.shortName, address: loc.address, kind: loc.kind, notes: loc.notes, sortOrder: loc.sortOrder });
  return (
    <li className={cx("grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1fr_2fr_auto_auto]", loc.archivedAt && "opacity-60")}>
      <input aria-label="Location name" className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input aria-label="Short name" className={inputClass} value={v.shortName} onChange={(e) => setV({ ...v, shortName: e.target.value })} />
      <input aria-label="Address" className={inputClass} placeholder="Address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
      <select aria-label="Use" className={inputClass} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Loc["kind"] })}>
        <option value="practice">Practices</option>
        <option value="meet">Meets</option>
        <option value="both">Both</option>
        <option value="away">Away venue</option>
      </select>
      <div className="flex gap-1">
        <Button size="sm" onClick={() => onSave(v)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onArchive(!loc.archivedAt)}>
          {loc.archivedAt ? "Restore" : "Archive"}
        </Button>
      </div>
    </li>
  );
}

function DataSection() {
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState<{ events: number; drills: number; templates: number; seasons: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<{ events: number; drills: number; templates: number; seasons: number }>("/api/admin/demo").then(setStatus).catch(() => {});
  }, []);
  useEffect(load, [load]);
  async function demo(action: "load" | "remove") {
    if (action === "remove" && !window.confirm("Remove ALL demo content (events, drills, templates, season)? Your real content is not touched. This cannot be undone.")) return;
    setBusy(true);
    try {
      await api("/api/admin/demo", { body: { action } });
      toast({ message: action === "remove" ? "Demo content removed." : "Demo season loaded.", tone: "success" });
      load();
      router.refresh();
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  const total = status ? status.events + status.drills + status.templates + status.seasons : 0;
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" aria-labelledby="data-h">
      <h2 id="data-h" className="text-lg font-bold text-slate-900">Data, exports and demo content</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a className="font-semibold text-gl-blue underline" href="/api/admin/export">
          Download full export (JSON)
        </a>
        <span className="text-slate-500">— includes private notes; store it privately. Database backups: see docs/OPERATIONS.md.</span>
      </div>
      <div className="rounded-md bg-slate-50 p-2 text-sm">
        <p className="font-semibold">Demonstration content</p>
        {status ? (
          <p className="text-slate-600">
            {total ? `${status.events} events, ${status.drills} drills, ${status.templates} templates, ${status.seasons} season(s) are labeled demo.` : "No demo content is loaded."}
          </p>
        ) : null}
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy || total > 0} onClick={() => demo("load")}>
            Load demo season
          </Button>
          <Button size="sm" variant="danger" disabled={busy || total === 0} onClick={() => demo("remove")}>
            Remove all demo content
          </Button>
        </div>
      </div>
    </section>
  );
}
