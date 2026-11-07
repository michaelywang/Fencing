# Deployment

The recommended setup is **Vercel (hosting) + Neon (PostgreSQL)**, both connected through Vercel's dashboard. It costs **$0/month** on their free plans for a team of this size (details in [Costs](#costs)). Students never pay or sign in.

> Status: the repository is fully deployable, and everything below was tested locally against PostgreSQL 16 with a production build. It has **not** been deployed to a live URL yet, because that requires your Vercel/Neon accounts. The steps take about 15 minutes.

## 1. Deploy on Vercel + Neon

1. **Create a Vercel account** at <https://vercel.com/signup> and sign in with the GitHub account that owns `michaelywang/Fencing`.
2. **Import the project.** In Vercel, choose *Add New… → Project*, pick the `Fencing` repository and click *Import*.
   - Framework preset: **Next.js** (auto-detected). Leave the build command empty: the `vercel-build` script runs migrations and then `next build`.
   - Production branch: the repository's default branch (currently `claude/brave-ramanujan-lnaobr`; you can merge it into `main` and switch later under *Settings → Git*).
3. **Add the database.** Before the first deploy, or right after if the first build fails for lack of a database:
   - In the Vercel project, open *Storage → Create Database → Neon (Serverless Postgres)*, accept the free plan, choose region **US East** (closest to New Jersey), and connect it to the project for **all environments**.
   - This sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used for migrations) automatically.
4. **Add the setup secret.** In *Settings → Environment Variables* add:
   - `SETUP_TOKEN`: a long random string. Generate one with `openssl rand -base64 32` (Mac Terminal), or use a password manager. Mark it as *Sensitive*.
   - `APP_URL` (optional): your final URL, e.g. `https://gl-fencing.vercel.app`, so invite links always use it.
5. **Deploy.** Choose *Deployments → Redeploy*, or push any commit. The build log should show `[migrate] database is up to date.` before `next build`.
6. **Check the deployment** by opening `https://<your-project>.vercel.app/api/health?db=1`. It should return `{"ok":true,"db":"ok"}`.

### Optional: a nicer URL

- Free: rename the project in *Settings → General* to change `<name>.vercel.app`. That is the permanent link to post in Google Classroom.
- Custom domain (about $12/year from any registrar): *Settings → Domains*. Then set `APP_URL` to the new domain.

Post **one** link in Google Classroom: `https://<your-domain>/` (the home page). Every public page is reachable from it, and it never changes when you publish.

## 2. Create the head-coach (administrator) account

1. Open `https://<your-site>/setup`.
2. Enter the `SETUP_TOKEN` value, your name, your email (your username) and a password of 10+ characters.
3. Optional: tick *Load the fictional demonstration season* to explore with sample data, then remove it in *Admin → Data → Remove all demo content*.
4. Once this account exists, `/setup` is permanently disabled. You may delete `SETUP_TOKEN` from Vercel afterwards (recommended).

## 3. Invite the other coaches

1. Go to *Coach planner → Admin → Coaches*, enter the coach's email (any domain: Gmail, Outlook, school), choose **Coach / editor** or **Administrator**, and click *Create invite*.
2. Copy the link and send it to them privately (text or email). It works once and expires after 7 days.
3. They open it, choose their own password, and are signed in. They can then use any device.

Forgotten passwords: an administrator clicks *Reset link* next to the coach and sends the link (valid 72 hours). If *every* administrator is locked out, see [OPERATIONS.md → Account recovery](OPERATIONS.md#account-recovery).

## 4. Optional: email delivery

Email is **not required**. Without it, administrators copy invite and reset links themselves, and "Forgot password" tells coaches to ask an administrator. To have the app email those links, add these environment variables (any SMTP provider works, e.g. a Gmail account with an app password, Outlook, or Resend SMTP) and redeploy:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...            # mark Sensitive
SMTP_FROM="GL Fencing <you@example.com>"
```

Once SMTP is set, coaches can also reset their own password from `/forgot`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection (pooled). Set by the Neon integration |
| `DATABASE_URL_UNPOOLED` | recommended | Direct connection for migrations. Set by the Neon integration |
| `SETUP_TOKEN` | first run only | Secret for creating the first administrator (16+ chars) |
| `APP_URL` | optional | Public base URL used in invite/reset links |
| `RECOVERY_TOKEN` | break-glass only | Enables `/recover` while set (24+ chars). Normally **unset** |
| `SMTP_*` | optional | Outgoing email for invites/resets |
| `DB_POOL_MAX` | optional | Connections per server instance (default 5) |

The full template, with no secrets, is in [`.env.example`](../.env.example).

## Costs

| Item | Plan | Cost | Notes |
| --- | --- | --- | --- |
| Vercel hosting | Hobby | $0 | Vercel's Hobby plan is for **non-commercial personal use**. A volunteer-run team calendar is non-commercial; if your school or district treats it as official, use Pro ($20/user/month) or a host from the next section |
| Neon PostgreSQL | Free | $0 | 0.5 GB storage (this app uses a few MB per season) and 100 compute-hours/month. The database sleeps when idle, so the first visit after a quiet period may take an extra second. Restore window: 6 hours |
| Neon PostgreSQL | Launch (optional) | usage-based, typically a few $/month at this size | Restore window up to 7 days |
| Domain name | optional | ~$12/year | |
| Email (SMTP) | optional | $0 with an existing mailbox | |

Students and families never pay and never need an account. Check current limits at <https://vercel.com/pricing> and <https://neon.com/pricing>; providers change them.

## Other hosts (Docker)

`Dockerfile` builds a production image that applies migrations at startup:

```bash
docker build -t gl-fencing .
docker run -p 3000:3000 -e DATABASE_URL=postgres://... -e SETUP_TOKEN=... gl-fencing
```

This works on Render, Railway, Fly.io or any VPS with a managed Postgres. Expect roughly $7–20/month for an always-on service plus a database. The image's runtime steps (production-only dependencies → migrations → `next start`) were verified locally; the image itself wasn't built here because no Docker daemon was available.

## Updating the app

Content changes (practices, drills, meets, publishing) **never** need code changes or redeploys. Code changes deploy automatically when a commit is pushed to the production branch. New database migrations run as part of every Vercel build.
