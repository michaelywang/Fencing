/**
 * Demo content CLI.
 *   npm run db:demo:load -- <admin-email>   # loads the fictional demo season
 *   npm run db:demo:remove                  # deletes every demo row (real content untouched)
 */
import "./env";
import { closeDb } from "@/server/db";
import { findUserByEmail } from "@/server/services/accounts";
import { loadDemoData, removeDemoData } from "@/server/services/demo";

async function main() {
  const [cmd, email] = process.argv.slice(2);
  if (cmd === "remove") {
    console.log("Removed demo content:", await removeDemoData(null));
    return;
  }
  if (cmd === "load") {
    if (!email) throw new Error("Usage: npm run db:demo:load -- <admin-email>");
    const user = await findUserByEmail(email);
    if (!user) throw new Error(`No account uses ${email}. Create the administrator first.`);
    console.log("Demo content:", await loadDemoData({ id: user.id, email: user.email, name: user.name, role: user.role }));
    return;
  }
  console.log("Commands: load <admin-email> | remove");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
