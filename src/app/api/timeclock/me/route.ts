import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { myStatus } from "@/lib/timeclock";
import { fetchProjects } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** My clock status + weekly per-project totals + the project list (one call). */
export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const [status, projects] = await Promise.all([myStatus(gate.user.key), fetchProjects()]);
  return NextResponse.json({ ...status, projects });
}
