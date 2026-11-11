# Architecture

One deployable web application (no microservices) backed by one PostgreSQL database.

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | One language for UI, API, and tests |
| Web framework | Next.js 16 (App Router), React 19 | Server-rendered public pages, interactive coach UI, API routes in one app; first-class Vercel hosting |
| Database | PostgreSQL 16 | Relational, durable, cheap managed hosting (Neon) with point-in-time restore |
| Data access | Drizzle ORM + SQL migrations in `drizzle/` | Typed queries, readable SQL migrations committed to the repo |
| Validation | zod | One schema validates API input, imports, and stored documents |
| Styling | Tailwind CSS 4 | Design tokens (school and weapon colors) live in one CSS file |
| Drag and drop | @dnd-kit/core (MIT) | Mouse, touch (iPad) and keyboard sensors |
| Auth | Built in (Node `crypto`) | Email + password, no third-party identity provider (see Security) |
| Tests | Vitest (unit + integration on real Postgres), Playwright (end-to-end) | |

No paid or commercially licensed component is used. Calendar views are purpose-built (the free tier of FullCalendar would only have covered the month grid, and the dense weapon cards, parallel week layout and practice views are custom anyway). All dependencies are MIT/Apache/ISC licensed.

## Source layout

```
src/
  app/                     Next.js routes
    (public)/              public read-only site: /, /week, /month, /e/[id], /season
    coach/                 coach workspace (requires sign-in)
    api/                   JSON API (coach + admin + public feed + health)
    login, setup, invite/[token], reset/[token], forgot, recover
  components/              UI (calendar, plan views, editor, coach pages)
  lib/                     pure, framework-free domain code (shared by server and browser)
    timeline.ts            per-weapon timing analysis
    sequencing.ts          auto start times for imports / "Pack timings"
    schedule.ts            "practice at a glance" grid builder
    projection.ts          PUBLIC PROJECTION (privacy boundary)
    schemas.ts             zod schemas for every document
    dates.ts               time-zone and DST-safe date math
    importFormat.ts, ics.ts, drills.ts, prepare.ts, ...
  server/                  server-only code
    db/                    Drizzle schema + connection pool
    auth/                  password hashing, sessions, rate limiting
    services/              business logic (events, publishing, library, accounts, import/export, demo)
    http.ts                route wrapper: authentication, authorization, CSRF, error mapping
drizzle/                   SQL migrations (applied by scripts/migrate.mjs)
tests/unit, tests/integration, tests/e2e
```

Route handlers are thin: they authenticate, parse the request, and call a service function. All rules live in the services, which are tested directly against PostgreSQL.

## Practice scheduling model

A practice is a list of **blocks**. Each block has:

- `start`: elapsed minutes from the practice start (0 is the first minute)
- `duration`: in minutes
- `scope`: `shared` (everyone together) or `weapon` (a weapon group)
- `weapons`: for weapon scope, which group(s) run it (usually one, e.g. `["foil"]`; `["foil","epee"]` is a joint group)

Foil, épée and saber blocks that overlap in time **run in parallel**. Each weapon's session is the shared blocks plus that weapon's own blocks; durations are never summed across weapons. `lib/timeline.ts` analyzes each weapon separately:

- **Overlaps**: two blocks in the same weapon's timeline intersect (a weapon block colliding with a shared block counts).
- **Gaps**: minutes between 0 and the last block where nothing is scheduled.
- **Total vs. target**: covered minutes (the union of intervals, so overlaps never double count) compared with the practice's `targetMinutes` (default 150).
- **Overrun**: the timeline runs past the target end.

Blocks flagged **"Runs alongside"** (`allowOverlap`, e.g. individual lessons pulled out of bouting) are intentional exceptions. They are excluded from overlap and coverage checks. All findings are **warnings**: saving is never blocked, and publishing asks for an explicit "publish anyway".

Because starts are elapsed minutes, changing the practice start time (e.g. 3:30 → 4:00) shifts every block automatically. Clock times shown in the UI are derived from the start time.

Imports may omit `start`. `lib/sequencing.ts` processes blocks in order with one cursor per weapon: a shared block starts when every weapon is free and moves all cursors, and a weapon block follows that weapon's previous block. The editor's "Pack timings" uses the same algorithm.

Unit tests cover a full 150-minute practice (shared frame plus parallel blocks, where a naive sum would give 330 minutes), plus gaps, overlaps, custom targets and joint-weapon blocks.

## Seasons, planning tracks and logical events

```
seasons            the workspace: dates, public visibility, live_generation (monotonic)
tracks             saved planning tracks per season (Track A, B, C …), soft-removable
logical_events     stable identity of "one event"; its id is the public URL (/e/<id>)
events             private working copies = one VARIANT per (track, logical event)
event_revisions    full private snapshots for history and restore
phases             track-specific (private) training phases
public_events      the LIVE schedule, keyed by logical id — the ONLY event table public routes read
public_phases      published phases
track_baselines    per track & logical event: the live generation this track last reconciled with
event_publications event-level provenance: what went live, from which track/row, previous payload
backup_snapshots   immutable, self-contained, schema-versioned copies of a public scope
backup_slots       (season, slot 1–3) → snapshot pointer + label
clear_batches      one row per "clear schedule" (actor, time, scope, items, backup used)
operations         idempotency records (client operation ids)
publish_log        operation-level public activity (+ the public change note)
drills, templates  shared library (track_id NULL) or track-only variants (track_id set)
```

**Selection is per tab.** The selected track is a URL parameter (`?track=`). Pages without it are redirected to the default (or the event's own track for `/coach/e/<id>`), so reload, bookmarks, Back/Forward and two tabs on different tracks all behave independently. No per-user "current track" is stored on the server.

**Identity.** A track holds at most one active variant per logical event (partial unique index `(track_id, logical_id) WHERE deleted_at IS NULL`). Duplicating a track copies rows with the same logical ids; publishing any track's variant updates the same public event and URL. Logical events never cross seasons. Import keys are unique per track among active rows (`(track_id, external_ref) WHERE deleted_at IS NULL`), so Trash rows never block a re-import. Import identity mapping is documented in [IMPORT_FORMAT.md](IMPORT_FORMAT.md#tracks-and-event-identity).

**Isolation.** Events, blocks and their drill snapshots, private/completed notes, phases and track-only drills/templates belong to a track. Shared drills/templates, locations, settings and accounts are global; imports change them only with an explicit `updateShared` choice.

## Publishing and the live schedule

- **Publication state is content-based**: each working copy is projected (`lib/projection.ts`, an explicit whitelist) and its hash (ignoring publish time and notice) is compared with the live payload: *draft* (nothing live), *published* (identical), *changed* (different). This is meaningful across tracks — Track B's copy shows *published* when students see exactly B's version.
- Every operation that changes the live schedule runs in **one transaction under a per-season row lock** (`SELECT … FOR UPDATE` on `seasons`) and allocates **one new live generation** (monotonic, never reused — also across clear, restore and rollback). Each changed logical event records the generation it last changed at.
- **Baselines / stale-plan detection.** A track records, per logical event, the live generation it last reconciled with (default: the track's `baseline_generation`). If the live event changed after that *and* the track would publish something different, the review reports a **conflict** (`live-changed`, `live-added` = would remove something newer, `live-removed` = would bring back something removed). The coach resolves each: overwrite, skip, or take the live version into the track. Unrelated events outside the selection or scope never block.
- **Two operations, one review engine** (`services/publishing.ts`):
  - *publish selected* — given rows (and explicit removals); nothing else changes;
  - *replace scope* — the pairs reviewed are logical ids whose **track variant or live version** falls in the scope (date range + kinds), so moves across the boundary are detected by identity using both the old live date and the new date; the result in scope equals the track exactly; out-of-scope events are preserved (a move *out* of the scope is published at its new date, never duplicated or dropped).
  - The server returns a **review token** (hash of every pair's row version, live generation and live content, plus phases). Executing a replacement requires the token; any change in between → `409 review_stale` with a fresh review.
- **Status-only cancel/reinstate** and **quick logistics updates** patch the *current live payload* (not the private document), so unfinished draft edits are never exposed. Logistics updates detect per-field conflicts against the values the coach started from, reconcile only those fields in the coach's working copy, set a public `notice`, and are undoable (an undo is a new, recorded patch). A notice is kept on later publishes only while the logistics fields are unchanged.
- **Delete** optionally unpublishes (explicit choice); the removed payload is kept on the row so *Undo / Restore + republish* can put it back where nothing newer is live.
- Every live change writes `event_publications` (who, which track/row, previous and new payload, operation id) and one `publish_log` row per operation (its note is the only one the public site shows, for 30 days; an older note never describes a newer state).
- **Public reads** use one read-only `REPEATABLE READ` transaction per page (`publicSnapshot`), so a page never mixes states before/after a replacement.

## Clear, Trash and backups

- **Clear** (`services/trash.ts`) previews exact private and public counts and returns a token. Execution (one transaction): lock season (+track) → recompute & compare token → if public content is affected, take a backup (slot required when all three are used) → remove live rows in scope (resolved from `public_events`, independent of the track's rows) → move the track's rows (whole documents) to Trash with `clear_batch_id`, bumping versions → optionally phases and track-only drills/templates → record the batch.
- **Versions never rewind.** Delete, clear and every restore increment the row version, so an autosave based on a pre-clear document is rejected (`409`) even after the row is restored.
- **Restore** (item, selection or batch) runs in one transaction. A collision with a newer active row of the same logical identity or import key aborts the whole restore with a conflict report; the coach re-submits with per-item `copy` (new identity, key dropped), `replace` (the active row goes to Trash) or `skip`. Bulk restores default to drafts; `publicRestore` (labelled in the UI) republishes stored public payloads only where nothing is live for that identity.
- **Purge** is administrator-only, re-counts and requires the reviewed count, and deletes rows permanently (all ages). Backups are untouched.
- **Backups** are immutable snapshot rows (public payloads with resolved venue/coach display, published phases, season display data, original publication metadata) referenced by three slot pointers. Restore = swap: capture current live (same scope) into a new snapshot, apply the slot's snapshot to live **in exactly its scope**, point the slot at the captured snapshot — atomically, under the season lock, idempotent per operation id, guarded by `expectedSnapshotId`. A restore whose target equals the current live content is a no-op and rotates nothing. Snapshots have no foreign keys to event rows, so Empty Trash, removed tracks and library/venue changes cannot break them.

## Operation integrity and limits

- Bulk endpoints accept a client **operation id**; it is inserted into `operations` inside the same transaction, so a retry after a lost response replays the stored result instead of acting twice (also under concurrency: the second insert waits for the first commit).
- Lock order is always season → track → rows; autosaves only lock their row. Concurrent publish/restore/clear on one season serialize; autosaves never deadlock with them.
- One request handles a full season: bulk operations are limited to **2,000 events** per request (imports to 1,500 by the file schema). Larger scopes return a clear `413` *before* anything changes; there is no multi-request chunking that could pretend to be atomic.
- Everything is authenticated (`apiRoute("coach" | "admin")`), CSRF-checked, validated, and sent with `Cache-Control: no-store`.

## Events, drafts and history

- Every save is an **optimistic-concurrency** write (`version`); stale writes get `409` with the current copy. The editor shows who saved and which fields differ.
- **Autosave** writes only the private working copy. Failed saves keep a recovery copy in `localStorage` keyed by **track and working-copy id** (`glf.backup.<trackId>.<rowId>`), so it can never be replayed into another track's variant. Every open editor registers with a per-tab flush registry; switching tracks flushes first and refuses to switch if a save cannot complete.
- **Revisions**: rapid autosaves by one coach within 10 minutes coalesce; publishes, moves, restores, cancels, logistics reconciliations, imports, clears and deletes always create their own revision.

Public pages are rendered per request (`dynamic = "force-dynamic"`, `Cache-Control: no-store`), so a publish is visible on the very next page load at the same URL.

## Time model

Events store a **local date**, **local wall-clock start/end times** and an **IANA time zone** (team default `America/New_York`). Moving or duplicating an event keeps "3:30 PM" as 3:30 PM across daylight-saving changes. The absolute instant is computed only when needed (`zonedTimeToUtc`). Tests cover both 2026–27 transitions, including the repeated and skipped hours.

## Drill library and snapshots

Library drills live in `drills`. Inserting one into a practice **copies** its content into the block and records `source = { drillId, version }`. Later library edits never touch scheduled practices. The block editor can check for a newer library version and update only when the coach confirms. "Save as library drill" copies block content into a new drill; private block notes are only copied, into the drill's coach-only notes, when explicitly requested.

## Security

- **Authentication**: email + password, no Google or other third-party sign-in. Passwords are hashed with scrypt (N=2^15, r=8, p=3 per OWASP), with parameters stored in each hash so they can be raised later. Login errors are identical for unknown emails and wrong passwords, and a dummy hash equalizes timing.
- **Sessions**: a random 256-bit token is stored in an HttpOnly, SameSite=Lax cookie (`__Host-` prefixed and Secure over HTTPS). Only its SHA-256 is stored in the database. Sessions last 30 days, renew on use, and are revoked on password change, reset, or account disable.
- **Bootstrap**: `/setup` works only while there are zero accounts **and** the `SETUP_TOKEN` secret is presented. There is no default password and no public sign-up. A Postgres advisory lock prevents a double bootstrap.
- **Invites and resets** are single-use, hashed, expiring tokens: 7 days for invites, 72 hours for admin-created resets, and 1 hour for emailed self-service resets.
- **Break-glass recovery**: either the operator CLI (needs the database URL) or `/recover`, which works only while a `RECOVERY_TOKEN` environment variable is set. Both are audited.
- **Authorization** is enforced in the API layer (`apiRoute("coach" | "admin")`) and again in the services, never only by hiding buttons. End-to-end tests call every mutating endpoint anonymously (401) and as a non-admin (403).
- **CSRF**: mutating requests must come from the site's own origin (`Origin` / `Sec-Fetch-Site` check), in addition to SameSite cookies.
- **Rate limiting** (stored in Postgres, so it works across serverless instances) covers login, setup, recovery, forgot-password and token use.
- **XSS**: coach-written text is a small Markdown subset rendered to React elements. Raw HTML is never interpreted, and links are limited to http(s)/mailto. The server also strips HTML tags and control characters on save. Responses carry a nonce-based CSP (`src/proxy.ts`), `X-Frame-Options: DENY`, `nosniff`, and a strict referrer policy.
- **Privacy**: public routes read only `public_events`, `public_phases`, public season fields and team settings — never `events`, `tracks`, `phases`, backups or batches. Track names, descriptions, private/completed notes and backup labels are coach-only. Event IDs are random UUIDs; a draft's ID returns 404 publicly. Permanent purge and backup deletion are administrator-only; exports require an administrator and are sent with `no-store`. No secrets are in browser code.

## Ready for a future AI integration

The app works fully without AI. For a later, authenticated integration:

- Everything an assistant needs is already a JSON API (`/api/events`, `/api/drills`, `/api/templates`, `/api/import` with `dryRun`).
- Proposals can be written as **drafts** (or imported with `dryRun: true` first), so nothing reaches students without a coach publishing it. Every change is attributed in revision history.
- To add it: create a per-user API token table (hashed tokens, like sessions), accept `Authorization: Bearer` in `apiRoute`, and grant tokens coach (not admin) rights. Origin checks don't apply to bearer tokens.
