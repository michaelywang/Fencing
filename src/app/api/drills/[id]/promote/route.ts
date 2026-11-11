import { apiRoute } from "@/server/http";
import { promoteDrill } from "@/server/services/library";

/** Explicit step: a track-only drill becomes part of the SHARED library. */
export const POST = apiRoute<{ id: string }>("coach", async ({ user, params }) => ({ drill: await promoteDrill(user, params.id) }));
