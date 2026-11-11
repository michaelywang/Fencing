# Import format (`gl-fencing-plan`, version 1)

Use this format to load a lot of planning data at once: a drill library, a season outline, practices built from those drills, and meets. The usual workflow:

1. Paste your messy notes into an AI assistant together with the prompt below.
2. Save the JSON it returns as a `.json` file.
3. In the coach planner, go to **Import → Planning file (JSON)**, upload it, and click **Check file**. Nothing is saved yet; you see what would be created or updated, plus any errors and warnings.
4. Click **Import**. Everything is saved in one step (all or nothing). New and changed events are **drafts** until you publish them.

Re-importing a file updates the items with the same `key` instead of duplicating them. Fix something in your notes, regenerate, and import again. Identical items are left untouched, so nothing reverts. Imports never publish anything and never touch the public site.

A complete working example is at [`public/examples/gl-fencing-import-example.json`](../public/examples/gl-fencing-import-example.json). It is also downloadable from the Import page, and the automated tests import it.

## Prompt to give your AI assistant

Copy everything in the box, then paste your notes at the end. The same text is on the Import page with a **Copy prompt** button.

```text
You are helping a high school fencing coach (foil, épée, saber) enter planning data into a calendar app.
Convert the notes I paste below into ONE JSON file in the "gl-fencing-plan" format, version 1.
Output only valid JSON (no comments, no explanations) so it can be saved as a .json file and uploaded.

FORMAT (all fields optional unless marked REQUIRED):
{
  "format": "gl-fencing-plan",            // REQUIRED, exactly this
  "version": 1,                           // REQUIRED
  "drills": [                             // reusable library drills
    { "key": "foil-parry4-riposte",       // REQUIRED, unique, lowercase-with-dashes; reuse the same key on later imports to update
      "title": "Parry 4 – riposte",       // REQUIRED
      "weapons": ["foil"],                // any of foil, epee, saber; [] = all weapons
      "category": "technical",            // warmup|footwork|technical|tactical|bouting|lesson|conditioning|break|closing|equipment|other
      "skills": ["parry-riposte"], "level": "beginner",   // level: beginner|intermediate|experienced|all
      "durationMin": 20, "equipment": ["Masks","Foils"], "tags": ["defense"],
      "objective": "...", "setup": "...", "steps": ["...","..."],
      "partnerRoles": "...", "rotation": "...", "cues": ["short cue","short cue"],
      "successCriteria": "...",
      "variations": { "beginner": "...", "experienced": "...", "easier": "...", "harder": "..." },
      "sets": "3", "reps": "5 each side", "work": "45 s", "rest": "15 s",
      "links": [{ "label": "Demo video", "url": "https://..." }],
      "coachNotes": "private, never shown to students" }
  ],
  "seasons": [
    { "name": "2026–27 Season", "startDate": "2026-11-16", "endDate": "2027-03-07",
      "phases": [ { "name": "Foundations", "startDate": "2026-11-16", "endDate": "2026-12-13", "focus": "...", "color": "sky" } ] }  // color: slate|sky|emerald|amber|rose|violet
  ],
  "events": [
    { "key": "2026-12-01-practice",       // stable id so re-importing updates instead of duplicating
      "kind": "practice",                 // practice|meet|tournament|recovery|holiday|other
      "date": "2026-12-01",               // REQUIRED, YYYY-MM-DD
      "start": "15:30", "end": "18:00",   // 24-hour local times; omit for all-day
      "location": "CMS Gold Gym",          // name or short name of a saved location; anything else is kept as venue text
      "title": "...", "theme": "...", "intensity": 3,          // intensity 1 Recovery … 5 Peak
      "targetMinutes": 150, "confirmation": "confirmed",        // or "tentative"
      "status": "scheduled",                // or "canceled" (+ "cancelReason")
      "objectives": ["..."], "announcement": "public note to fencers", "equipment": ["..."],
      "coaches": { "shared": "Coach A", "foil": "...", "epee": "...", "saber": "..." },
      "levelNotes": { "beginner": "...", "experienced": "..." },
      "privateNotes": "coach-only",
      "meet": { "opponent": "...", "homeAway": "away", "reportTime": "14:30", "busDepart": "14:45", "busReturn": "19:30", "address": "...", "details": "..." },
      "blocks": [                           // the timed practice plan, IN ORDER
        { "lane": "shared", "duration": 15, "title": "Dynamic warm-up", "category": "warmup" },
        { "lane": "foil",  "duration": 25, "drill": "foil-parry4-riposte" },
        { "lane": "epee",  "duration": 25, "drill": "epee-point-ladder", "cues": ["override cue"] },
        { "lane": "saber", "duration": 25, "title": "Attack in preparation", "category": "tactical" },
        { "lanes": ["foil","epee"], "duration": 20, "title": "Joint point control" },
        { "lane": "shared", "duration": 10, "title": "Water break", "category": "break" }
      ] }
  ]
}

RULES
- Foil, épée and saber blocks happen AT THE SAME TIME. Do not add their minutes together.
- Omit "start" on blocks: the app schedules them in order. A shared block begins when every weapon group is free; a weapon block follows the previous block of that weapon.
- For a standard practice, shared blocks + each weapon's blocks should add up to targetMinutes (default 150) for EVERY weapon.
- To reuse a drill, define it once under "drills" and reference its key in blocks ("drill": "key"). Block fields override the drill's (e.g. a progressive variation or different cues).
- To show progression across the season, reuse the same drill key with different "variations"/"cues"/"notes" on later dates instead of creating near-duplicate drills.
- Put lineup thoughts, injuries or evaluations only in privateNotes/coachNotes — never in announcement, notes, or titles. Better still, leave student personal data out entirely.
- Use 24-hour HH:MM times and YYYY-MM-DD dates. Leave out anything you don't know rather than guessing.
- Mark meets you are unsure of as "confirmation": "tentative".

MY NOTES:
(paste your notes here)
```

## Field reference

### Top level

| Field | Required | Notes |
| --- | --- | --- |
| `format` | yes | Exactly `"gl-fencing-plan"` |
| `version` | yes | `1` |
| `drills` | | Drills, upserted by `key` — into the **target track** by default (see below) |
| `templates` | | Practice templates, upserted by `key` (same fields as an event's practice fields, without a date) — target track by default |
| `seasons` | | The season matching the target track's season (by name, or the only season in the file). Its `phases` replace the **target track's** phases. Name/date changes are shared and need the explicit shared option. Other seasons in the file are skipped with a warning |
| `locations` | | Matched by `name` / `shortName`. Creating or changing shared locations needs the explicit shared option; otherwise unknown venues become venue text |
| `events` | | Practices, meets, tournaments, recovery days, holidays, other. Upserted by `key` **within the target track** |

### Events

| Field | Notes |
| --- | --- |
| `key` | Stable identifier, e.g. `2026-12-01-practice`. Re-importing the same key into the same track updates that track's event (unchanged content = no change at all). A published event gets the import as an **unpublished draft change**, so students keep the old version until you publish. Exports use the import key, or the event's logical id when it has none, so a re-imported export updates the original events |
| `kind` | `practice` (default), `meet`, `tournament`, `recovery`, `holiday`, `other` |
| `date` | `YYYY-MM-DD` (local to the team time zone) |
| `start`, `end` | `HH:MM` 24-hour local times. Practices default to the team's start time and *start + targetMinutes*. Omit both for all-day items |
| `location` | Name or short name of a saved location (`CMS Gold Gym`, `GL Red Gym`, …). Anything else is stored as venue text and listed as a warning |
| `title`, `theme`, `intensity` (1–5), `targetMinutes` (default 150) | |
| `confirmation` | `confirmed` (default) or `tentative` |
| `status`, `cancelReason` | `scheduled` (default) or `canceled` |
| `objectives`, `equipment` | Lists of short strings |
| `announcement` | Public text shown prominently to fencers |
| `weaponSummaries` | `{ foil, epee, saber }`: short text for calendar cards. Optional; derived from the plan when blank |
| `coaches` | `{ shared, foil, epee, saber }` coach names |
| `levelNotes` | `{ beginner, experienced }` public notes |
| `privateNotes`, `completedNotes` | Coach-only, never published |
| `meet` | `{ opponent, homeAway: home/away/neutral, reportTime, busDepart, busReturn, address, details }` |
| `template` | Key of a template to start from. Event fields override it |
| `blocks` | The timed plan, see below |

### Blocks (the practice plan)

List blocks **in order**. Each needs a `title` or a `drill` key.

| Field | Notes |
| --- | --- |
| `lane` | `shared`, `foil`, `epee`, or `saber`. Use `lanes: ["foil","epee"]` for a joint group |
| `duration` | Minutes (default: the drill's typical length, else 15) |
| `start` | Optional elapsed minute (`35` or `"0:35"`). When omitted, the app schedules it: a shared block waits until every weapon group is free, and a weapon block follows that weapon's previous block |
| `drill` | Key of a library drill (from this file or an earlier import). The drill's instructions are **copied** into the practice |
| `title`, `category` | `category`: warmup, footwork, technical, tactical, bouting, lesson, conditioning, break, closing, equipment, other |
| `coach`, `station`, `notes` (public), `privateNotes` | |
| `allowOverlap` | `true` for intentional parallel activities such as lessons during bouting |
| Any drill field | `objective`, `setup`, `equipment`, `steps`, `partnerRoles`, `rotation`, `cues`, `successCriteria`, `variations`, `sets`, `reps`, `work`, `rest`, `links`. These override the drill's values for this practice only, which is the way to express **progressions** across the season |

Foil, épée and saber blocks at the same time run **in parallel**. The import report warns when any weapon's plan doesn't add up to `targetMinutes`, or has gaps or overlaps.

### Drills

`key` (required), `title` (required), `weapons` (`[]` = all), `category`, `skills`, `level` (`beginner`/`intermediate`/`experienced`/`all`), `durationMin`, `equipment`, `tags`, `objective`, `setup`, `steps`, `partnerRoles`, `rotation`, `cues`, `successCriteria`, `variations` (`beginner`, `experienced`, `easier`, `harder`), `sets`, `reps`, `work`, `rest`, `links` (`[{ "label", "url" }]`, http/https only), `coachNotes` (private).

## Tracks and event identity

Every import goes into **one planning track** (the *Import* page uses the track open in that tab; the CLI requires `--track`). Imports never change the public schedule or phases — publishing is a separate, reviewed step. If the check reports any error, applying the file saves nothing (one transaction).

**Event keys → identity**, for target track *T* in season *S*:

1. an **active** event of *T* with this import key → update it;
2. else, for a UUID-shaped key, an active event of *T* whose logical id (public link id) or working-copy id equals the key → update it;
3. else **create** a new event in *T*, reusing an identity where one exists:
   - a UUID-shaped key that is a logical event of season *S* (e.g. from an export of this season) → that identity;
   - the same key used by another track's event in *S* (or by an event in Trash) → its identity. This is what makes "the same file in Track A and Track B" describe the *same* events: publishing either track's version updates one public link, never two;
   - otherwise a brand-new identity.

UUID-shaped keys are never looked up outside the target track and season, so an exported row id can't update another track or season. Uniqueness of keys is enforced per track **among active rows only**, so re-importing after clearing works even though the old rows are in Trash; the report lists keys that reuse a trashed event's identity, and restoring that trashed event later asks you to *keep both* (new identity) or *replace*. Duplicate keys within one file are an error.

**Shared resources.** By default (`updateShared` off / no `--shared`):
- drills and templates in the file are created as **track-only** copies (keyed per track); a shared drill/template with the same key and identical content is reused unchanged;
- shared locations and season name/dates are not changed; the report lists every shared change it *would* make (“Proposed (not applied)”).
With the explicit shared option, those shared items are created/updated instead and listed as applied.

**Sizes.** Up to 1,500 events, 1,000 drills and 200 templates per file; a whole season is one request and one transaction. Split larger plans by date range.

## iCalendar (.ics) files

**Import → Calendar file (.ics)** converts a meet schedule (e.g. exported from a league or athletic-department calendar) into this format so you can review it before importing:

- Times are converted to the team time zone. All-day entries stay all-day.
- The type is guessed from the title ("@"/"at"/"vs" → meet; "Championship"/"Invitational" → tournament; "No school"/"holiday" → holiday). The opponent and home/away come from "vs. X" / "@ X".
- Entries are marked **tentative** by default (untick to import as confirmed), and the calendar's UID becomes the key, so re-importing an updated .ics updates the same events.
- Repeating entries import only their first occurrence (with a warning). Use *Duplicate to other dates* for the rest.

You can also give the .ics file to an AI assistant (or to the developer) and ask for a `gl-fencing-plan` file that, for example, adds bus times from a separate transportation sheet.

## Direct import from the command line (assistant or developer)

Anyone working in this repository with the production `DATABASE_URL` (for example an AI coding assistant you've asked to enter data) can import without the web page. The data still arrives as drafts in the chosen track, credited to a coach account:

```bash
npm run import -- plan.json --as you@example.com --track "Track B"                 # dry run: report only, nothing saved
npm run import -- plan.json --as you@example.com --track "2026–27 Season/Track B" --apply
npm run import -- meets.ics --as you@example.com --track <track-id> --apply        # iCal; add --confirmed or --kind tournament
npm run import -- plan.json --as you@example.com --track "Track A" --shared --apply # also update SHARED drills/templates/venues
```

Without `--track` the command lists the available tracks and stops.

The database URL is a full-access credential. Share it only with people or tools you trust, and prefer the upload page when that's enough.

## Export (planning export)

Administrators can download a **planning export** in this same format (*Import* page → *Export*): one track (`/api/admin/export?track=<id>`, importable into any track for a round trip), or every season and track (`/api/admin/export`). It contains the coaches' **working copies, including private notes** — keep it private.

Exports add a versioned extension that importers ignore:

```json
"planningExport": { "version": 2, "kind": "track" | "all", "season": "…", "track": "…", "note": "…", "workspaces": [ … ] }
```

`workspaces` (whole-app export only) lists every season with each track's phases and events. Drills and templates carry `"trackOnly": true` when they belong to one track. Older files without the extension (and version-1 exports) import as before.

A planning export is **not** an image of the public schedule: drafts may differ from what is published. Published history lives in the app's three **public backups** (self-contained snapshots of what students saw); see [OPERATIONS.md](OPERATIONS.md).
