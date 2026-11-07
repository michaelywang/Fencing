import { NextResponse } from "next/server";
import { getPublicMeta } from "@/server/services/public";

export async function GET() {
  return NextResponse.json({ meta: await getPublicMeta() }, { headers: { "Cache-Control": "no-cache" } });
}
