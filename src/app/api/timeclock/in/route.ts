import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { clockIn, STANDBY_ID } from "@/lib/timeclock";
import { fetchProjects } from "@/lib/projects";
import { syncWorking, syncStandby } from "@/lib/slack-status";

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
  // Mirror to Slack (opt-in) — fire-and-forget so it never slows a clock-in.
  const projectId = result.projectId;
  if (projectId === STANDBY_ID) {
    syncStandby(gate.user.key);
  } else {
    void (async () => {
      const name = (await fetchProjects()).find((p) => p.id === projectId)?.name;
      syncWorking(gate.user.key, name);
    })().catch(() => {});
  }
  return NextResponse.json({ active: { projectId: result.projectId, inAt: result.inAt } });
}
