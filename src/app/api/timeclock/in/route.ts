import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { clockIn } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clock in. If already active on another project and `switch` is not set,
 * answers 200 with `needSwitch` so the UI can confirm — the swap itself
 * (close there + open here) is atomic inside the store.
 */
export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  let body: { projectId?: string; switch?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const result = await clockIn(gate.user, body.projectId, body.switch === true);
  if ("conflict" in result) {
    return NextResponse.json({ needSwitch: true, current: result.conflict });
  }
  return NextResponse.json({ active: { projectId: result.projectId, inAt: result.inAt } });
}
