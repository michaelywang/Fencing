import { apiRoute } from "@/server/http";

export const GET = apiRoute("coach", async ({ user }) => ({ user }));
