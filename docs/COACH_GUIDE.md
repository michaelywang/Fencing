# Coach guide

Everything happens in the browser and saves to the shared online database, so there is nothing to export, redeploy or re-post. Students always use the same team link.

- **Public team link** (post in Google Classroom): `https://<your-site>/`
- **Coach sign-in**: `https://<your-site>/login` (or the *Coach sign-in* link at the bottom of any public page)

## The views

| View | Where | Use it for |
| --- | --- | --- |
| **Month** | *Coach planner → Month* | The season's shape: phases (colored bars), meets, intensity, draft/published status. Drag cards between days to move them. Click a card to edit it in the side panel; the month and filters stay put |
| **Week** | *Week* | Compare the week's practices side by side, one row per lane (Shared / Foil / Épée / Saber). Edit the theme and intensity inline. Publish or duplicate the whole week |
| **Practice editor** | Side panel, or *Full page* | Build the timed plan, details, private notes, history |
| **Drill library** | *Drill library* | Reusable drills with instructions, cues and variations |
| **Templates** | *Templates* | Reusable practice plans |
| **Season** | *Season* | Season dates and training phases (shown publicly) |
| **Publish** | *Publish* | Everything students can't see yet, grouped by week |

Badges are always written out, never shown by color alone: **Draft** (only coaches see it), **Published**, **Changes** (published, with unpublished edits), **Tentative**, **Canceled**, and intensity from *Recovery* to *Peak*.

## Create a practice

1. *Month* → **+ New event** (or the small **+** in a day) → choose **Practice**, or a practice **from a template**.
2. The practice opens in the side panel as a **draft** that saves automatically. The status reads *Saving…* then *✓ Saved*.
3. **Plan** tab:
   - **Practice starts** and **Target minutes** (default 150).
   - Add **Shared** blocks for warm-up, footwork, breaks, the closing circle and equipment return.
   - Add **Foil**, **Épée** and **Saber** blocks for the parallel parts. Weapon blocks at the same time run *simultaneously*; they are not added together.
   - **+ From drill library** inserts a drill as an editable copy. Choose its lane, or *Add a parallel copy for each weapon*.
   - Each block has: time, minutes, coach, strip/station, objective, key cues (shown as chips), steps, partners and rotation, sets/reps/work/rest, success criteria, beginner/experienced/easier/harder variations, video links, a public note, and a 🔒 private note.
   - Use **↑ ↓** to swap a block with its neighbor, **Replace with library drill…** to swap content, and **Pack timings** to close gaps.
   - The **timing check** shows each weapon's minutes (e.g. *Foil 150/150 ✓*) and warns about gaps, overlaps and totals. Warnings never block saving. Tick **Runs alongside** for intentional overlaps such as individual lessons during bouting.
4. **Details** tab: type, title, date, times, location (*CMS Gold Gym* and *GL Red Gym* are preset; other venues can be typed), confirmed or tentative, theme, intensity, objectives, the **announcement** fencers see, equipment, per-weapon calendar summaries, coach assignments, and beginner/experienced notes. Meets and tournaments also get **opponent, home/away, report time, bus departure and bus return**.
5. **Private notes** tab: coaching notes and *completed notes* (what actually happened). These are never published.

Keyboard: **Ctrl/⌘+S** saves immediately.

## Preview and publish

- **Preview as students see it** opens exactly what students will see once it's published, private notes excluded.
- **Publish** (one event), **Publish week** (Week view), or the **Publish** page (any selection). Add an optional *change note*, e.g. "Thursday moved to the Gold Gym"; it appears on the public site with the update time.
- Students see published changes immediately at the same link.

## Revise a published practice

- Just edit it. Your edits save as a **private draft** (badge *Changes*), and students keep seeing the published version.
- **Save & publish changes** pushes your edits live in one step.
- **Discard changes** goes back to exactly what students see.
- If you only need a quick fix on a published practice, make the edit and click *Save & publish changes* right away.

## Cancel, move, unpublish, delete

- **Cancel**: *More → Cancel event…*, with a reason shown to students. Tick *Show the cancellation on the public calendar now*; the event stays visible to students, marked **Canceled**. Only the status and reason are published, so unfinished edits stay private. *Reinstate…* reverses it.
- **Move**: drag the card to another day on the Month view (*Undo* is offered), or change the date on the *Details* tab. Times stay the same, including across daylight-saving changes. For a published event, the move is a draft change until you publish it.
- **Unpublish**: *More → Unpublish* removes it from the public calendar entirely.
- **Delete**: *More → Delete…*, then *Undo*, or restore it later from **Trash**.

## Duplicate practices and weeks

- **One practice**: *More → Duplicate to other dates…*. Add one or more dates (e.g. the same weekday for the next 4 weeks), and choose whether to copy coach assignments and private notes. Notes are not copied by default.
- **A whole week**: *Week → Duplicate week…*. Pick any date in the target week; events keep their weekdays and times.
- **Template**: *More → Save as template…*, then use it from *Templates* or **+ New event → from a template**.

Copies are always new **drafts** with fresh history.

## Restore a previous version

Open the event → **History**. Every save is listed with author and time; rapid autosaves are grouped. **View** shows that version and **Restore** brings it back as a new version, so restoring can itself be undone. If the event is published, the restored version is a draft change until you publish.

## When two coaches edit at once

If someone else saved the same event while you were editing, you'll see **"Someone else saved this event"** with their name, the time, and which parts differ. Choose **Keep my version** or **Use their version**. Nothing is overwritten silently, and the other version stays in History.

## Drill library workflow

1. Build the library first: *Drill library → + New drill*, or import many at once (below).
2. Filter by weapon, skill, level, length, equipment, tag, or search text.
3. Insert drills into practices with **+ From drill library**. Each insert is an independent copy, so editing the library later never changes past or scheduled practices. To pull in an updated version, use **Check library for updates** on a block.
4. Show progression by reusing the same drill on later dates and editing that practice's copy (cues, variations, notes) as skills improve.
5. Turn any good block into a drill with **Save as new library drill**. Private notes are left out unless you choose otherwise.

## Bulk entry from messy notes (AI-assisted)

*Import* page → copy the **AI prompt**, paste it into your AI assistant followed by your notes, and upload the JSON it returns. Click **Check file** to see what will be created, updated, or warned about (nothing is saved yet), then **Import**. Imported events arrive as drafts. Re-importing with the same keys updates them instead of duplicating. Format details: [IMPORT_FORMAT.md](IMPORT_FORMAT.md).

You can also upload an **iCal (.ics)** meet schedule on the same page. Each calendar entry becomes a tentative draft meet to review and publish.

## Administrators

*Admin* page:

- **Coaches**: invite, reset link, change role, disable.
- **Team settings**: name, time zone, default practice start/length/location, public welcome text, whether coach names appear publicly.
- **Locations**: addresses, archiving.
- **Data**: full JSON export, and load/remove the demo season.

## Privacy rules of thumb

- The public link is shareable by design. Don't put medical information, evaluations or lineup deliberations in titles, announcements or block notes.
- Private notes (🔒) never appear publicly, in previews, or in copies, unless you explicitly choose to copy them.
- Avoid student names in practice plans. The app doesn't need any student data.
