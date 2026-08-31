import { NextRequest, NextResponse } from "next/server";
import { requireUser, internalOk } from "@/lib/user-key";
import { dailyAttendance } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-day attendance history — main app reads this for the agent digest. */
export async function GET(req: NextRequest) {
  if (!internalOk(req)) {
    const gate = await requireUser();
    if (gate.denied) return gate.denied;
  }
  const days = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? "30")));
  return NextResponse.json({ days: await dailyAttendance(days) });
}
