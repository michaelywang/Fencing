import { apiRoute } from "@/server/http";
import { listPendingInvites, listUsers } from "@/server/services/accounts";
import { emailEnabled } from "@/server/email";

export const GET = apiRoute("admin", async () => ({
  users: await listUsers(),
  invites: await listPendingInvites(),
  emailEnabled: emailEnabled(),
}));
