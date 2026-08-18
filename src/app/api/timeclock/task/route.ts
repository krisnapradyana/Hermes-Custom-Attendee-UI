import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { setTaskStatus, TaskStatus } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change one of MY tasks' status (proxied to the main app, which enforces
 *  that only the assignee or creator may do this). */
export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  let body: { projectId?: string; taskId?: string; status?: TaskStatus };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.projectId || !body.taskId || !body.status) {
    return NextResponse.json({ error: "projectId, taskId, status required" }, { status: 400 });
  }

  const ok = await setTaskStatus(gate.user.key, body.projectId, body.taskId, body.status);
  if (!ok) return NextResponse.json({ error: "Could not update the task" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
