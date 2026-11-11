# Coach guide

Everything happens in the browser and saves to the shared online database, so there is nothing to export, redeploy or re-post. Students always use the same team link.

- **Public team link** (post in Google Classroom): `https://<your-site>/`
- **Coach sign-in**: `https://<your-site>/login` (or the *Coach sign-in* link at the bottom of any public page)

## Two ideas to know first

1. **Planning tracks.** Each season has one or more saved *tracks* — complete, separately editable versions of the season plan (Track A, Track B, Track C …). Tracks are shared by all coaches. **Which track you are editing belongs to this browser tab** (it is in the page address), so another coach — or your other tab — can work in a different track at the same time without affecting you.
2. **Nothing reaches students until you publish.** Editing any track only changes that track. Students see the **published schedule**, which you change on purpose: by publishing an event, a week, or a reviewed replacement, or with a quick logistics update or cancellation.

The bar under the menu always shows both: **Editing Track B** (amber) and, separately, when the *public schedule* last changed.

## The views

| View | Where | Use it for |
| --- | --- | --- |
| **Month** | *Month* | The track's season shape: phases, meets, intensity, draft/published status. Drag cards between days to move them. Click a card to edit it in the side panel. **Clear…** opens the clear-schedule dialog |
| **Week** | *Week* | The week's practices side by side, one row per lane (Shared / Foil / Épée / Saber). Inline theme/intensity edits. Publish, preview or duplicate the week |
| **Practice editor** | Side panel, or *Full page* | The timed plan, details, private notes, history (private versions + public changes) |
| **Drill library / Templates** | *Drill library*, *Templates* | The shared library, plus items marked “Only in Track B” that belong to one track |
| **Season** | *Season* | The track's season overview and **its** training phases; season name/dates; publishing phases |
| **Tracks** | *Tracks* | Create, duplicate, rename, open and remove tracks |
| **Publish** | *Publish* | Before/after review of this track against the public schedule; publish selected changes or replace a date range |
| **Backups** | *Backups* | Three saved copies of the *public* schedule; one-click restore |
| **Trash** | *Trash* | Deleted and cleared items (every age), restore and — for administrators — permanent deletion |
| **Import** | *Import* | Load a planning file into the open track |

Badges are always written out, never shown by color alone: **Draft** (only coaches see it), **Published** (this track matches what students see), **Changes** (students see something different), **Tentative**, **Canceled**, **Updated** (a recent logistics change), and intensity from *Recovery* to *Peak*.

## Compare plans with Track A, B and C

1. *Tracks* → **New track** → *Duplicate a track* (choose Track A) → name it “Track B” → **Create track**. The duplicate is faithful: practice plans, drill copies, coach assignments, private and completed notes, canceled/tentative states, phases and Track-A-only drills all come along.
   Other starting points: *Copy the currently published schedule* (only what students can see, no private notes), an *Empty track*, or *Load a saved public backup as a draft track*.
2. **Open Track B** (or pick it in the switcher). Edit freely — drag practices around, rewrite December, change phases on the *Season* page, import an alternative plan. Track A and the public site do not change.
3. To compare, open Track A in a second browser tab: each tab keeps its own track, also after reloading or using Back/Forward. *Publish → Review changes* shows exactly how a track differs from what students see.
4. When you decide, publish from the winning track (next sections). Remove the other tracks with *Tracks → Remove* (they go to Trash and can be restored).

Track names, descriptions, phases and private notes are never shown to students.

**Switching tracks while editing:** the switcher first saves anything you typed. If a save can't finish (for example you are offline), it does **not** switch; it tells you which event is unsaved. Your typing stays in the editor and in this device's recovery copy for that track.

## Create a practice

1. *Month* → **+ New event** (or the small **+** in a day) → choose **Practice**, or a practice **from a template**. It is created in the track that is open in this tab.
2. The practice opens in the side panel as a **draft** that saves automatically (*Saving…* then *✓ Saved*).
3. **Plan** tab:
   - **Practice starts** and **Target minutes** (default 150).
   - **Shared** blocks for warm-up, footwork, breaks, the closing circle and equipment return; **Foil**, **Épée** and **Saber** blocks for the parallel parts. Weapon blocks at the same time run *simultaneously*.
   - **+ From drill library** inserts an editable copy of a drill (shared, or this track's own).
   - Each block has time, minutes, coach, strip/station, objective, cues, steps, partners/rotation, sets/reps/work/rest, success criteria, variations, video links, a public note and a 🔒 private note.
   - The **timing check** shows each weapon's minutes (e.g. *Foil 150/150 ✓*) and warns about gaps and overlaps. The weapon filter on the calendar only changes what you *see*; it never removes other weapons' blocks or changes what gets published.
4. **Details** tab: type, title, date, times, location, confirmed or tentative, theme, intensity, objectives, the **announcement**, equipment, per-weapon summaries, coach assignments, level notes. Meets also get opponent, home/away, report time and bus times.
5. **Private notes** tab: coaching notes and *completed notes* (what actually happened). Never published.

Keyboard: **Ctrl/⌘+S** saves immediately.

## Publish

**One event** — in the editor: **Publish** / **Save & publish changes**. Only this event changes publicly; its link stays the same.

**A week** (the usual in-season step):
1. *Week* → **Publish week** to publish the week's ticked drafts and changes, *or* **Review week vs. published…** for the full before/after.
2. On the *Publish* page, *Week of …* is preselected. **Review changes** lists additions, changes (date/time, location, cancellation, practice plan), removals, and published events outside the week that stay as they are.
3. Tick what to publish → **Publish N selected changes**. Unticked items and every other date stay exactly as published. Removals are only made if you tick them.

**Replace a date range** — *Publish* → choose *From today to the end of the season*, *Entire season* or *A date range* → **Review changes** → **Replace published schedule for these dates**. Afterwards the public schedule in that range matches this track exactly (including removing events the track doesn't have); published events outside the range are kept. A backup of the public range is saved first (see the 3-slot rule below). Training phases can be included with the checkbox.

The review also flags:
- **Moves across the edge of the range** (e.g. a practice moved from the 30th to the 2nd): the event is moved, never duplicated or silently dropped.
- **Past dates** and events with **completed notes** — untick them, or choose future dates, if you only meant to change upcoming plans. Completed notes are private and never published.
- **Conflicts**: the published version changed after this track last matched it (another coach published, canceled, or made a logistics update). For each, choose *Use this track's version*, *Leave the public version*, or *Update this track to match*. Nothing newer is overwritten without a decision.

Add an optional *note for students*; it appears on the public site with the update time and is replaced by the next change's note.

## Revise a published practice

- Just edit it. Edits save as a **private draft** (badge *Changes*); students keep seeing the published version. **Save & publish changes** pushes them live; **Discard changes** returns to what students see (your private notes are kept).
- If the editor says **“The published version changed after this track last matched it”**, someone published a newer version (from another track, or a cancellation/logistics update). *Use the published version in this track…* brings it in; publishing from here will ask before overwriting.

## Quick logistics update (snow days, bus changes)

For a published event: *More → Quick logistics update (publish now)…*

1. The dialog starts from **what students see now** — not from your unfinished edits.
2. Change the date, start/end time, venue, report time or bus departure/return. Add a short notice (e.g. “Snow: moved to Wednesday 4:30”) or let the app write one.
3. **Publish this update now.** Students see the new details and an *Updated* notice right away, at the same link. Nothing else about the event changes publicly — half-finished drill or plan edits stay private.
4. Your working copy gets the same new date/time/venue; your other edits are kept.
5. If another coach changed the same field a moment earlier, you'll see both values and can cancel or publish yours anyway.
6. **Undo:** *History → Public changes → Undo this update* (recorded as its own change, with a notice).

## Cancel, move, unpublish, delete

- **Cancel**: *More → Cancel event…* with a reason. Tick *Show the cancellation on the public calendar now*; students still see the event, marked **Canceled**, with the reason. Only the status and reason are published. *Reinstate…* reverses it.
- **Move**: drag the card, or change the date on *Details*. Times stay the same across daylight-saving changes; the event keeps its link. For a published event the move is a draft until you publish (or use a quick logistics update).
- **Unpublish**: removes it from the public calendar entirely.
- **Delete**: *More → Delete…* moves this track's copy to Trash. *Also remove it from the public schedule* is ticked when the event is published — untick it to leave the public version alone. *Undo* restores it (and republishes it if it was removed).

## Clear a season (or a date range)

*Month* → **Clear…**

1. **What to clear:** *Only Track B* (default — private, students see no change), *Only the published schedule* (backup first), or *Both* (one step, backup first). Clearing the published schedule works on what students see, whichever track it came from.
2. **Which dates:** *Entire season — every month* (not just the month on screen), *A date range*, or *From today*. Optionally only some event types (e.g. practices only).
3. Optionally include the track's **phases** and **track-only drills/templates**. The shared library, accounts, settings, other tracks and other seasons are never cleared.
4. **Count what will be cleared** shows exact numbers (private and public), past events and completed notes, and where the backup goes. Then confirm.

Everything cleared goes to **Trash as one batch** with whole documents (plans, notes).

## Restore from Trash

*Trash* lists deleted and cleared items of the season — nothing expires on its own.
- **Restore whole batch as drafts** brings back everything from one clear. *Restore batch + its public versions* (only for batches that also cleared the public schedule) also republishes them where nothing is published now — it says so on the button.
- Single items: **Restore as draft**, or **Restore + republish** for events that were published.
- Tick several items for **Restore selected**.
- If a newer event has the same identity or import key (e.g. you re-imported after clearing), nothing is restored yet: you choose *Keep both*, *Replace the active one* (it moves to Trash) or *Leave in Trash*. A restore never half-happens.
- **Administrators** can delete permanently: selected items, a batch, *Empty Trash for Track B*, *for the season*, or *the whole app*. The confirmation shows the count and scope. Saved public backups are not touched — they may still contain previously published versions.

## Restore a published backup (one click) and the three-slot limit

*Backups* shows up to **three saved public schedules** for the season, with name, time, who saved it, scope, dates and event count. Backups are made automatically before clearing the public schedule or replacing a range, and you can *Save backup* any time.

- **Restore public schedule: <scope>** — one click. That saved version becomes what students see for exactly that scope (other dates, other seasons, every track and all private notes are untouched). The schedule it replaced moves into the same slot, so clicking again swaps back. The other two slots don't change. If students already see that version, nothing happens.
- **Preview**, **Rename**, **Load as draft track** (to edit it), and — administrators — **Delete…**.
- **All three slots full?** A clear or replacement that needs a backup shows the three backups and asks which one to replace — or cancel. A backup is never replaced silently.

## Import into a track

*Import* (the target is the track open in this tab — the page says “Import into Track B”).
1. Upload or paste the file → **Check file**: shows the target track, what will be created/updated/unchanged, events that become this track's version of an event another track has (same keys = same public link), keys that reuse something in Trash, and any **shared** changes it *would* make.
2. **Import**. Events arrive as drafts in this track only; the public schedule never changes on import. If anything has an error, nothing is saved.
3. Drills and templates in the file become **this track's own copies**; identical shared ones are simply reused. Tick *Also update the SHARED library…* only when you really want to change the shared library, venues or season dates — the check lists those changes first.
4. The same file can go into Track A and Track B; re-importing an unchanged file changes nothing; importing again after clearing works.

## Duplicate practices and weeks

- **One practice**: *More → Duplicate to other dates…* (coach assignments and private notes only if you choose; completed notes and cancellations never carry over).
- **A whole week**: *Week → Duplicate week…*.
- **Template**: *More → Save as template…* (shared, or *Only for this track*).

Copies are new **drafts** in the same track. (Duplicating a whole *track* is different — it copies everything faithfully; see above.)

## History, conflicts, drills

- **History** lists every private save (with author) and **Public changes** (every publication of this event from any track, with undo for logistics updates). *Restore* brings an old private version back as a new version.
- If someone else saved the same event while you were editing, you choose *Keep my version* or *Use their version*; nothing is overwritten silently.
- Drill library: inserts are independent copies. *Only in Track B · share…* turns a track-only drill into a shared one (a separate, explicit step).

## Walkthroughs

**Preseason (planning the winter):**
1. *Season*: create the season (it starts with Track A). Add phases to Track A.
2. *Import* an AI-generated season into Track A (Check → Import).
3. *Tracks*: duplicate A into B; import or edit an alternative December in B. Optionally create C from the published schedule.
4. Compare in two tabs; *Publish → Review changes* on each to see how each differs from what's posted.
5. From the winning track: *Publish → Entire season → Replace published schedule* (backup saved), and *Season → Publish these phases*.

**In season (week to week):**
1. Open the posted track; revise Tuesday's drills (private draft).
2. *Week → Publish week* (or *Save & publish changes* in the editor) — only that week/event changes publicly.
3. After practice, add *completed notes* (never published, never overwritten by later publishing).
4. Snow day: *Quick logistics update* or *Cancel event…* — published immediately, your unfinished edits stay private.
5. Wrong publish? *Backups → Restore public schedule* (one click, reversible) or *History → Public changes → Undo*.

## Administrators

*Admin*: coaches (invite, reset link, role, disable), team settings, locations, demo season, and the **planning export** (*Import* page: one track, or every season and track). Only administrators can permanently delete from Trash or delete a saved backup.

## Privacy rules of thumb

- The public link is shareable by design. Don't put medical information, evaluations or lineup deliberations in titles, announcements or block notes.
- Private notes (🔒), completed notes, track names/descriptions, unpublished phases and backup labels never appear publicly.
- Avoid student names in practice plans. The app doesn't need any student data.
