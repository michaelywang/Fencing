/**
 * Copy-paste instructions for an AI assistant that turns unorganized notes
 * into the "gl-fencing-plan" import format. Mirrored in docs/IMPORT_FORMAT.md.
 */
export const AI_IMPORT_PROMPT = `You are helping a high school fencing coach (foil, épée, saber) enter planning data into a calendar app.
Convert the notes I paste below into ONE JSON file in the "gl-fencing-plan" format, version 1. Output only the JSON.

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
`;
