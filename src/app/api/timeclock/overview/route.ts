import { NextRequest, NextResponse } from "next/server";
import { requireUser, internalOk } from "@/lib/user-key";
import { overview } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whole-team pulse: who is clocked in right now and everyone's hours.
 * Read by the main app's Team page server-to-server (internal token),
 * and by any signed-in member.
 */
export async function GET(req: NextRequest) {
  if (!internalOk(req)) {
    const gate = await requireUser();
    if (gate.denied) return gate.denied;
  }
  return NextResponse.json({ members: await overview() });
}
