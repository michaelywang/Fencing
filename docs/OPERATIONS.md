# Operations: backups, restore, recovery

## Backup status at a glance

| Layer | What it protects | Status | Cost |
| --- | --- | --- | --- |
| **In-app history** (revisions, Trash, undo) | Accidental edits/deletes/clears of events, phases and track-only drills | **Built in, always on** (verified by automated tests) | $0 |
| **Published backups** (3 slots per season) | Earlier versions of what students saw; one-click, reversible restore | **Built in.** Automatic before clearing or replacing the public schedule; manual any time | $0 |
| **Neon point-in-time restore** | The whole database, back to any moment in the restore window | **Automatic once Neon is connected.** Free plan: 6 hours. Launch plan: up to 7 days | $0 / paid |
| **Planning export (JSON)** | Portable copy of tracks, drills, templates, phases and notes (Import → Export) | **Manual**: a person clicks it (suggested: weekly during the season) | $0 |
| **Nightly encrypted `pg_dump`** (`.github/workflows/backup.yml`) | Full database copy kept 30 days on GitHub | **Not active until you add two repository secrets** (see below) | $0 within GitHub's free Actions minutes |

Nothing has been configured on your accounts yet. The table describes what each layer does once set up.

> The free plan's 6-hour restore window is short. For a season's worth of planning, either turn on the nightly backup workflow (free) **or** upgrade Neon to Launch for a 7-day window. Doing both is best.

## In-app recovery (coaches)

These are **application-level** recoveries. They are not a database disaster-recovery backup: if the database itself is lost or corrupted, use Neon point-in-time restore or a `pg_dump` (below).

- **Undo an edit**: event → *History* → *View* a version → *Restore* (a new version, so it can be undone).
- **Undo a delete or a clear**: the toast's *Undo*, or *Trash* → *Restore as draft* / *Restore whole batch as drafts*. Republishing is a separate, labelled choice (*Restore + republish*). Trash keeps items until an administrator deletes them permanently — nothing expires automatically.
- **A wrong publish, replacement or clear of the public schedule**: *Backups* → *Restore public schedule* (one click; the replaced version goes into the same slot, so it can be swapped back). A single logistics update: event → *History → Public changes → Undo this update*.
- **Unsaved edits after a crash or lost connection**: reopen the event on the same device. The editor offers the recovery copy kept in that browser for that track.

### Checkpoint before a big change (recommended)

Before replacing a whole season or importing a large plan:
1. *Backups → Save backup (whole season)* — an instant, in-app copy of the public schedule.
2. *Import → Export → Download <track>* (administrators) — a portable copy of the planning track, including notes.
3. For maximum safety, a database dump (`pg_dump`, below) or note the time for Neon point-in-time restore.

Permanent deletion from Trash does **not** delete saved public backups, planning exports you downloaded, database dumps or Neon history; previously published content may survive there.

## Neon point-in-time restore

In the Neon Console (reachable from Vercel → *Storage* → your database → *Open in Neon*):

1. *Branches* → choose the production branch → *Restore*.
2. Pick a timestamp inside the restore window and confirm. Neon keeps a backup branch of the pre-restore state.
3. Reload the site. No redeploy is needed, since the connection string is unchanged.

Prefer the in-app history for single events. A database restore rolls back **everyone's** changes since that moment.

## Turn on the nightly encrypted backup (free)

1. In Neon, copy the **direct** connection string (Vercel env var `DATABASE_URL_UNPOOLED`, or Neon → *Connect* → disable *Connection pooling*).
2. Create a long passphrase (`openssl rand -base64 32`) and store it in your password manager. Without it the backups cannot be decrypted.
3. On GitHub: repository → *Settings → Secrets and variables → Actions → New repository secret*:
   - `BACKUP_DATABASE_URL` = the direct connection string
   - `BACKUP_PASSPHRASE` = the passphrase
4. *Actions → Nightly database backup → Run workflow* to test it. A successful run shows an artifact named `gl-fencing-db-backup` holding a `.dump.gpg` file. Runs repeat every night and are kept for 30 days.

Dumps are encrypted before upload, so private coaching notes are never stored in readable form on GitHub, even if the repository is public.

### Restore from a GitHub Actions backup

```bash
# 1. Download the artifact zip from the workflow run and unzip it, then decrypt:
gpg --decrypt gl-fencing-2026-12-01T0717Z.dump.gpg > restore.dump
# 2. Restore into the database (direct connection string). This REPLACES current data:
pg_restore --clean --if-exists --no-owner --no-privileges -d "postgres://…direct-url…" restore.dump
```

To try a restore safely first, create a new Neon branch, restore into that branch's connection string, and look around before touching production.

### Manual backup from any computer

```bash
pg_dump --format=custom --no-owner "postgres://…direct-url…" > gl-fencing-$(date +%F).dump
```

## Planning export (JSON, administrators)

*Import → Export* downloads either one track (importable into any track: a round trip) or every season and track (`planningExport.workspaces`), with drills, templates, phases, locations, events (including private notes and publication state) and the coach roster (names, emails, roles; **never** passwords or tokens). It uses the import format plus a versioned `planningExport` extension — see [IMPORT_FORMAT.md](IMPORT_FORMAT.md#export-planning-export). It is a copy of the **working plans**, not of the public schedule, and not a database backup. Store it privately.

## Account recovery

From most to least common:

1. **One coach forgot their password**: an administrator opens *Admin → Coaches → Reset link* and sends the link (valid 72 hours). If email (SMTP) is configured, coaches can also use *Forgot password* themselves.
2. **Every administrator is locked out, and you can run commands**: from a computer with this repository and the production `DATABASE_URL`:
   ```bash
   APP_URL=https://<your-site> DATABASE_URL="postgres://…" npm run admin -- reset-link you@example.com
   # or create a brand-new admin invite:
   APP_URL=https://<your-site> DATABASE_URL="postgres://…" npm run admin -- invite-admin you@example.com "Your Name"
   ```
   The command prints a one-time link. Anyone with the database URL already controls the data, so this adds no new risk. You can also ask the developer (or an AI assistant with repository access) to run it for you.
3. **Every administrator is locked out, and you only have the Vercel dashboard**:
   1. Vercel → *Settings → Environment Variables* → add `RECOVERY_TOKEN` = a new random string of 24+ characters → *Redeploy*.
   2. Open `https://<your-site>/recover`, enter that token and your email, and open the 1-hour reset link it shows.
   3. **Delete `RECOVERY_TOKEN` and redeploy.** While it is set, anyone who learns it could reset an account.

Every recovery action is recorded in the `audit_log` table.

## Demo content

- Load: *Admin → Data → Load demo season*, or `npm run db:demo:load -- you@example.com`. It creates a separate *DEMO Season* with its own Track A, publishes it, and shows a cancellation and an unpublished edit.
- Remove: *Admin → Data → Remove all demo content*, or `npm run db:demo:remove`. This deletes the demo season with everything it owns (tracks, events, its live schedule, backups, Trash) and demo drills/templates; real seasons and content are untouched.

## Upgrading to planning tracks (migration `0002_tracks`)

Deploying this version runs `drizzle/0002_tracks.sql` automatically (Vercel `vercel-build` → `npm run db:migrate`; Docker at start). It is one transaction:

1. **Before deploying**, take a checkpoint: Neon → note the time (point-in-time restore) and/or `pg_dump` (below), plus a planning export.
2. The migration assigns every existing event to a season — the season whose dates contain it; events outside every season go to the **nearest** season (dates are not changed); if events exist but no season does, a hidden “Main season” is created. Nothing is discarded. A fresh installation gets an academic-year season (e.g. “2026–27 Season”).
3. Each season gets **Track A**. Every event keeps its id as its logical id, so every `/e/<id>` link, published payload, revision, Trash item, import key and unpublished edit is unchanged; the live schedule, phases (copied to `public_phases`) and publication comparisons are identical. Track A's baseline is set to the migrated live state.
4. After deploying, open *Tracks* and *Publish → Review changes*: Track A should show the same drafts/changes as before and no conflicts.

Rollback: the migration cannot be reversed in place. Restore the pre-deploy checkpoint (Neon point-in-time or `pg_restore`) and redeploy the previous commit.

Verified by `tests/integration/legacy-upgrade.test.ts` (a populated previous-release database upgraded through the real migration runner: byte-identical public payloads and revisions, same links, preserved unpublished edits and Trash) and by the fresh-install path every test run uses.

## Limits (Vercel + Neon)

- One request handles a whole season: up to **2,000 events** per bulk operation (publish, replace, clear, restore, duplicate track) and 1,500 per import file. Larger scopes are refused with a clear message **before** anything changes; split them by date range. Each operation is one transaction — never a sequence of partial commits.
- A full-season replacement or import touches the database a few thousand times; with Vercel and Neon in the same region this takes seconds. Keep the Vercel function in the Neon region (see DEPLOYMENT.md).

## Monitoring

- `GET /api/health` returns `{"ok":true}` when the app is up.
- `GET /api/health?db=1` also checks the database (`503` if unreachable).

A free uptime monitor (e.g. UptimeRobot) can poll the first URL. Polling the `?db=1` version every few minutes keeps the Neon free database from ever sleeping, which uses up compute hours, so poll it no more than hourly.

## Local development

```bash
docker compose up -d                  # Postgres 16 with fencing_dev and fencing_test databases
cp .env.example .env.local            # then set SETUP_TOKEN to any 16+ character value
npm install
npm run db:migrate
npm run dev                           # http://localhost:3000 → /setup to create your admin
```

Without Docker, install PostgreSQL 16 (e.g. Postgres.app on a Mac), create a `fencing` user and the `fencing_dev`, `fencing_test` and `fencing_e2e` databases, and point `DATABASE_URL` at `fencing_dev`.

Tests:

```bash
npm test             # unit + integration (uses TEST_DATABASE_URL / fencing_test; resets it)
npm run test:e2e     # production build + browser tests (uses fencing_e2e; resets it)
npm run lint && npm run typecheck
```

## Schema changes (developers)

Edit `src/server/db/schema.ts`, run `npm run db:generate` to create a new SQL file in `drizzle/`, review it, and commit it. Migrations are applied automatically on every Vercel build (`vercel-build`) and at Docker container start, or manually with `npm run db:migrate`.
