import { apiRoute } from "@/server/http";
import { drillFacets } from "@/server/services/library";

export const GET = apiRoute("coach", async () => drillFacets());
