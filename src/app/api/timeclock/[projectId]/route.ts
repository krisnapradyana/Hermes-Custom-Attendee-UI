import { NextRequest, NextResponse } from "next/server";
import { requireUser, internalOk } from "@/lib/user-key";
import { projectReport, deleteSession } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-project report: member aggregates + 30-day history. Readable by any
 * signed-in member AND by the main app server-to-server (internal token) —
 * that's what powers the project detail "Team" tab.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!internalOk(req)) {
    const gate = await requireUser();
    if (gate.denied) return gate.denied;
  }
  return NextResponse.json(await projectReport(projectId));
}

/** Owner-only mistaken-session delete (closed, < 24h old). ?session=<id> */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { projectId } = await params;
  const sessionId = req.nextUrl.searchParams.get("session") ?? "";
  const ok = await deleteSession(gate.user.key, projectId, sessionId);
  if (!ok) return NextResponse.json({ error: "Cannot delete this session" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
