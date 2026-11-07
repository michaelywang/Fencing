/**
 * Import a planning file (gl-fencing-plan JSON) or an iCalendar file (.ics)
 * directly into the database — for an assistant or developer entering data
 * on a coach's behalf. Everything arrives as DRAFTS credited to the given coach.
 *
 *   npm run import -- plan.json --as coach@example.com            # dry run (default): report only
 *   npm run import -- plan.json --as coach@example.com --apply    # actually import
 *   npm run import -- meets.ics --as coach@example.com --apply [--confirmed] [--kind tournament]
 *
 * Requires DATABASE_URL (the same database the site uses).
 */
import "./env";
import fs from "node:fs";
import { closeDb } from "@/server/db";
import { findUserByEmail } from "@/server/services/accounts";
import { runImport } from "@/server/services/transfer";
import { getSettings } from "@/server/services/settings";
import { icsToImport } from "@/lib/ics";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && !process.argv[process.argv.indexOf(a) - 1]?.startsWith("--"));
  const email = arg("--as");
  const apply = process.argv.includes("--apply");
  if (!file || !email) throw new Error("Usage: npm run import -- <file.json|file.ics> --as <coach-email> [--apply] [--confirmed] [--kind meet|tournament|other]");
  const user = await findUserByEmail(email);
  if (!user || user.disabledAt) throw new Error(`No active account uses ${email}.`);
  const text = fs.readFileSync(file, "utf8");
  let data: unknown;
  if (file.toLowerCase().endsWith(".ics")) {
    const settings = await getSettings();
    const kind = (arg("--kind") as "meet" | "tournament" | "other" | undefined) ?? "meet";
    const converted = icsToImport(text, { timezone: settings.timezone, kind, tentative: !process.argv.includes("--confirmed") });
    console.log(`Converted ${converted.count} calendar entries.`);
    for (const w of converted.warnings) console.log(`  ! ${w}`);
    data = converted.data;
  } else {
    data = JSON.parse(text);
  }
  const report = await runImport({ id: user.id, email: user.email, name: user.name, role: user.role }, data, { dryRun: !apply });
  console.log(apply ? (report.ok ? "Imported (as drafts)." : "Import FAILED — nothing was saved.") : report.ok ? "Dry run OK — nothing saved. Re-run with --apply to import." : "Dry run found errors — nothing saved.");
  for (const [k, v] of Object.entries(report.counts)) if (v.created || v.updated) console.log(`  ${k}: ${v.created} new, ${v.updated} updated`);
  for (const e of report.errors) console.log(`  ✗ ${e}`);
  for (const w of report.warnings) console.log(`  ! ${w}`);
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
