# GL Fencing — season, week & practice planner

A web app for planning and sharing the **Governor Livingston High School fencing** season (foil, épée, saber).

- **Coaches** sign in with their own email and password to plan the season, build timed practices with parallel foil/épée/saber plans, keep a drill library, and publish.
- **Students and families** use one permanent link, with no account and no cost, to see today's or the next practice, their weapon's plan, the week, the month and the season, on any phone, tablet or laptop.

All content lives in a shared online PostgreSQL database. Routine changes (practices, meets, drills, publishing) never require code changes, exports, redeploys or reposting the link.

> **Status:** complete and tested locally (production build + PostgreSQL 16). **Not yet hosted.** Hosting needs your free Vercel and Neon accounts; follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), which takes about 15 minutes.

## What's included

| Area | Highlights |
| --- | --- |
| Month & season | Month calendar with prev/next/Today, compact cards (time, theme, intensity, per-weapon summaries, draft/published status for coaches), confirmed vs. tentative, cancellations, training-phase bands, drag-and-drop moves with Undo, filters kept in the URL, side-panel editing. Season overview with phases, weekly load and competitions |
| Weekly planning | Days as columns and Shared/Foil/Épée/Saber as rows, so you can compare a week at a glance. Inline theme and intensity edits, per-weapon minute checks, coach assignments, Publish week, Duplicate week |
| Daily practice | Parallel schedule grid, expandable Shared/Foil/Épée/Saber sections, Expand all / Collapse all, weapon filter, cues visible at a glance, step-by-step instructions, variations, YouTube thumbnails and links |
| Timing model | Shared + parallel weapon blocks, validated **per weapon** for overlaps, gaps and totals vs. a configurable target (default 150 min). Warnings never block saving |
| Drill library | Search and filter by weapon, skill, level, length, equipment and tags. Inserting creates an editable **snapshot**; later library edits never change scheduled practices. Save any block as a drill |
| Templates & copying | Practice templates, duplicate to other dates, duplicate whole weeks (DST-safe), optional copying of coaches and private notes (off by default) |
| Planning tracks | Track A/B/C per season, shared by coaches; the selected track is per browser tab (URL). Faithful duplicate, create from the published schedule or from a backup, rename, reversible remove. Track-only drills/templates/phases. Switching flushes autosaves first |
| Publishing | Nothing public changes until you publish. Before/after review of a track vs. the public schedule; publish selected events (or a week), or replace a reviewed date range exactly (moves across the range edge handled by stable event identity); conflict detection when the live schedule changed after a track's baseline; status-only cancel; **quick logistics update** (date/time/venue/report/bus, with a student-facing notice and undo); change notes with a last-updated time |
| Clear, Trash & backups | One clear dialog (track only / published only / both, whole season or date range, optional event types), whole documents to Trash as one batch, restore items/selection/batch with conflict handling, admin-only permanent purge, **three published backup slots** per season with one-click reversible restore |
| Reliability | Autosave status, offline retry with an on-device (per-track) recovery copy, unsaved-change guard, conflict detection between coaches, revision history with restore, atomic idempotent bulk operations, monotonic versions across clear/restore |
| Accounts & security | Own email + password auth (no Google sign-in), invite links for any email domain, admin reset links, optional SMTP, secure first-run setup token, break-glass recovery, server-side authorization, CSRF and rate limiting, CSP, sanitized text, private notes never in public data |
| Data | AI-friendly JSON import into a chosen track with dry run (shared library changes only on request), iCal (.ics) meet import, planning export (per track or all), migrations, removable demo season |

## Routes

| Who | URL | What |
| --- | --- | --- |
| Public | `/` | **Post this one in Google Classroom.** Today / next up, the next 7 days, the weapon picker |
| Public | `/week`, `/month`, `/season`, `/e/<id>` | Week plan, month calendar, season overview, one event's full plan |
| Coaches | `/login` | Sign in |
| Coaches | `/coach/calendar`, `/coach/week`, `/coach/e/<id>` | Month, week, full-page editor |
| Coaches | `/coach/drills`, `/coach/templates`, `/coach/season`, `/coach/tracks`, `/coach/publish`, `/coach/backups`, `/coach/import`, `/coach/trash`, `/coach/account` | Library, templates, phases, planning tracks, publishing, published backups, import, trash, password |
| Admins | `/coach/admin` | Coaches and invites, team settings, locations, export, demo data |
| First run | `/setup` | Create the first administrator (needs `SETUP_TOKEN`; then disabled forever) |
| Recovery | `/forgot`, `/reset/<token>`, `/invite/<token>`, `/recover` | Password help, invite acceptance, break-glass recovery |
| Ops | `/api/health`, `/api/health?db=1` | Uptime checks |

## Getting started

1. **Deploy**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Vercel + Neon, $0/month on their free plans).
2. **Create the head-coach account** at `/setup` with the `SETUP_TOKEN` you set in Vercel. Optionally load the fictional demo season to explore, and remove it later in Admin.
3. **Invite coaches**: *Admin → Coaches → Create invite*, then send them the link. They choose their own password.
4. **Add content**: build the drill library, then the season's phases, then practices and meets. See the [coach guide](docs/COACH_GUIDE.md), or bulk-load messy notes with an AI assistant using the [import format](docs/IMPORT_FORMAT.md) (the prompt is also on the Import page).
5. **Publish** a week, then share `https://<your-site>/`.

### Having an AI assistant (or me) enter data for you

- **Practices and drills from notes:** give the assistant the prompt from the Import page plus your notes, then upload the JSON it returns (*Import → Check file → Import*).
- **Meets from an iCal file:** upload the `.ics` on the Import page, or ask for a `gl-fencing-plan` file that adds bus and report times.
- **Have an assistant enter it directly:** with repository access and the database URL, it can run `npm run import -- <file> --as you@example.com --apply` (see [IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md#direct-import-from-the-command-line-assistant-or-developer)).
- Imports always arrive as **drafts**. Nothing reaches students until a coach publishes.

## Local development

```bash
docker compose up -d                 # or a local PostgreSQL 16 (see docs/OPERATIONS.md)
cp .env.example .env.local           # set SETUP_TOKEN to any 16+ character value
npm install
npm run db:migrate
npm run dev                          # http://localhost:3000/setup
```

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop / build / serve |
| `npm run db:migrate` · `npm run db:generate` | Apply / create migrations |
| `npm run db:demo:load -- you@example.com` · `npm run db:demo:remove` | Demo season |
| `npm run admin -- list \| invite-admin <email> \| reset-link <email>` | Operator CLI (account recovery) |
| `npm run import -- <file.json\|file.ics> --as <email> --track "<track>" [--apply] [--shared]` | Import planning data as drafts into a track from the command line |
| `npm test` · `npm run test:e2e` · `npm run lint` · `npm run typecheck` | Quality checks |

## Tests

| Suite | Count | Covers |
| --- | --- | --- |
| Unit (`tests/unit`) | 26 | Per-weapon timing (150-minute shared + parallel plans, gaps, overlaps, targets), auto-sequencing, schedule grid, DST and time zones, the public projection never leaking private fields, sanitization, link safety |
| Integration on real PostgreSQL (`tests/integration`) | 63 | Planning tracks (faithful duplicate, isolation, from published), publish selected vs. scoped replacement (moves across the scope edge, review tokens), multi-month clear into one Trash batch, backups of the live version vs. private edits, Empty Trash then backup restore, three slots with swaps/no-ops/idempotent retries, scoped restore with renamed venues and library edits, imports into A and B (idempotency, re-import after clear, Trash restore collisions, UUID keys, shared-resource isolation, no partial commits), stale-baseline conflicts and concurrent operations, >90-day Trash and purge permissions, cancellation-only publishing across tracks, the snow-day logistics update with undo, a populated legacy-database upgrade and a database without seasons; plus draft vs. publish, edit-as-draft, save & publish, discard, unpublish, publishing a cancellation without leaking drafts, optimistic-concurrency conflicts, revision history and restore, soft delete/undo, DST-safe moves and duplication (event and week), drill snapshots, templates, import/export round trips, iCal conversion, setup token, login and rate limits, invites, resets, last-admin protection, break-glass recovery |
| End-to-end on a production build (`tests/e2e`, Chromium) | 36 | Two tabs on different tracks, duplicating a track in the UI, publishing one event from Track B at the same link, autosave flush when switching tracks and direct/back-forward URLs, the snow-day logistics update, clearing a season (track + public) and one-click backup swaps, the new pages at phone/iPad/desktop; plus setup, sign-in, building and publishing a parallel plan in the UI, anonymous student reading, edit-as-draft then publish at the same URL, draft invisibility and preview, inviting a coach on another device, two-coach conflict, history restore, delete/undo/trash, drag-and-drop move, API authorization (401/403/CSRF), public HTML/feeds free of private data, cache and security headers, and responsive checks at phone, iPad portrait/landscape and desktop with no horizontal scrolling |

All suites pass, and CI runs them on every push (`.github/workflows/ci.yml`).

## Documentation

- [docs/COACH_GUIDE.md](docs/COACH_GUIDE.md): planning tracks (A/B/C), publishing a week or a range, quick logistics updates, clearing, Trash, published backups and the three-slot limit, imports into a track, preseason and in-season walkthroughs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data model (seasons, tracks, logical events, live schedule, baselines, backups), publication and concurrency semantics, security
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): hosting, environment variables, admin bootstrap, inviting coaches, email, costs
- [docs/OPERATIONS.md](docs/OPERATIONS.md): in-app vs. database recovery, checkpoints, the tracks migration and rollback, limits, account recovery, demo data, monitoring, local setup
- [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md): the JSON import format, track targeting and identity mapping, the planning-export extension, and the AI prompt
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, the scheduling model, the publishing model, security

## Customizing

- **Weapon colors:** `src/app/globals.css` → the `WEAPON COLORS` block (labels: `src/lib/weapons.ts`).
- **School colors:** the same file, `--color-gl-red` / `--color-gl-blue`.
- **Team name, time zone, default start/length/locations, public welcome text:** *Admin → Team settings* (no code change).

## Known limitations

- **Not yet hosted.** A public URL requires connecting your Vercel/Neon accounts ([steps](docs/DEPLOYMENT.md)).
- **Backups:** Neon's free plan keeps a 6-hour restore window. Turn on the included encrypted nightly backup workflow (add two GitHub secrets) and/or use Neon Launch for 7 days. Neither is active until you configure it.
- **Email is optional and off by default.** Invite and reset links are copied by an administrator unless SMTP is configured.
- **Keyboard drag-and-drop:** to move an event without a mouse or touch, change its date on the Details tab.
- **Repeating calendar entries** in `.ics` files import only their first occurrence (with a warning).
- **No notifications** (by design for v1); updating the shared calendar is the notification.
- **Free-plan caveats:** Vercel Hobby is for non-commercial use; Neon's free database may take about a second to wake after a quiet period.
