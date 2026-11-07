import { NextResponse, type NextRequest } from "next/server";
import { getPublicEvent } from "@/server/services/public";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const event = await getPublicEvent(id);
  if (!event) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404, headers: { "Cache-Control": "no-cache" } });
  return NextResponse.json({ event }, { headers: { "Cache-Control": "no-cache" } });
}
