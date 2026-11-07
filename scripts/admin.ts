/**
 * Operator CLI — requires DATABASE_URL (anyone with it already controls the data).
 *
 *   npm run admin -- list
 *   npm run admin -- invite-admin <email> [name]   # works even if every admin is locked out
 *   npm run admin -- invite-coach <email> [name]
 *   npm run admin -- reset-link <email>            # one-time password reset link (24 h)
 *
 * Set APP_URL so printed links point at the deployed site (default http://localhost:3000).
 */
import "./env";
import { closeDb } from "@/server/db";
import { createInviteAsOperator, createResetLinkForUser, findUserByEmail, listUsers } from "@/server/services/accounts";

const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

async function main() {
  const [cmd, email, ...nameParts] = process.argv.slice(2);
  switch (cmd) {
    case "list": {
      const users = await listUsers();
      if (users.length === 0) console.log("No accounts yet. Use /setup (with SETUP_TOKEN) or `invite-admin`.");
      for (const u of users) console.log(`${u.role.padEnd(5)}  ${u.disabledAt ? "DISABLED " : ""}${u.email}  (${u.name})`);
      break;
    }
    case "invite-admin":
    case "invite-coach": {
      if (!email) throw new Error("Usage: npm run admin -- " + cmd + " <email> [name]");
      const res = await createInviteAsOperator({ email, role: cmd === "invite-admin" ? "admin" : "coach", name: nameParts.join(" ") }, appUrl);
      console.log(`Invite link (expires ${res.expiresAt}):\n${res.url}`);
      break;
    }
    case "reset-link": {
      if (!email) throw new Error("Usage: npm run admin -- reset-link <email>");
      const user = await findUserByEmail(email);
      if (!user) throw new Error(`No account uses ${email}.`);
      const res = await createResetLinkForUser(null, user.id, appUrl, { ttlHours: 24 });
      console.log(`Password reset link for ${user.email} (expires ${res.expiresAt}):\n${res.url}`);
      break;
    }
    default:
      console.log("Commands: list | invite-admin <email> [name] | invite-coach <email> [name] | reset-link <email>");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
