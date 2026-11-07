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
| `drills` | | Library drills, upserted by `key` |
| `templates` | | Practice templates, upserted by `key` (same fields as an event's practice fields, without a date) |
| `seasons` | | Upserted by `name`. If `phases` is given, it replaces that season's phases |
| `locations` | | Upserted by `name` / `shortName` (e.g. away venues with addresses) |
| `events` | | Practices, meets, tournaments, recovery days, holidays, other. Upserted by `key` |

### Events

| Field | Notes |
| --- | --- |
| `key` | Stable identifier, e.g. `2026-12-01-practice`. Re-importing the same key updates the event. A published event gets the import as an **unpublished draft change**, so students keep the old version until you publish. Exports use the event's internal id as its key, so a re-imported export updates the original events |
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

## iCalendar (.ics) files

**Import → Calendar file (.ics)** converts a meet schedule (e.g. exported from a league or athletic-department calendar) into this format so you can review it before importing:

- Times are converted to the team time zone. All-day entries stay all-day.
- The type is guessed from the title ("@"/"at"/"vs" → meet; "Championship"/"Invitational" → tournament; "No school"/"holiday" → holiday). The opponent and home/away come from "vs. X" / "@ X".
- Entries are marked **tentative** by default (untick to import as confirmed), and the calendar's UID becomes the key, so re-importing an updated .ics updates the same events.
- Repeating entries import only their first occurrence (with a warning). Use *Duplicate to other dates* for the rest.

You can also give the .ics file to an AI assistant (or to the developer) and ask for a `gl-fencing-plan` file that, for example, adds bus times from a separate transportation sheet.

## Export

Administrators can download everything in this same format (*Admin → Data → Download full export*). Use it as a portable backup, or hand it to an AI assistant as context ("here is my current season — propose next week's practices as an import file").
