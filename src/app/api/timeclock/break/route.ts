import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { toggleBreak, STANDBY_ID, GENERAL_ID } from "@/lib/timeclock";
import { fetchProjects } from "@/lib/projects";
import { syncBreak, syncWorking, syncStandby, syncGeneral } from "@/lib/slack-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Toggle break on the caller's active session. Break time is not counted. */
export async function POST() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const result = await toggleBreak(gate.user.key);
  if (!result) {
    return NextResponse.json({ error: "Not clocked in" }, { status: 409 });
  }
  // Mirror to Slack (opt-in), fire-and-forget.
  if (result.onBreak) {
    syncBreak(gate.user.key);
  } else if (result.projectId === STANDBY_ID) {
    syncStandby(gate.user.key);
  } else if (result.projectId === GENERAL_ID) {
    syncGeneral(gate.user.key);
  } else {
    const projectId = result.projectId;
    void (async () => {
      const name = projectId
        ? (await fetchProjects()).find((p) => p.id === projectId)?.name
        : undefined;
      syncWorking(gate.user.key, name);
    })().catch(() => {});
  }
  return NextResponse.json(result);
}
