import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { myStatus } from "@/lib/timeclock";
import { fetchProjects, fetchMyTasks } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** My clock status + weekly totals + project list + my open tasks (one call). */
export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const [status, projects, tasks] = await Promise.all([
    myStatus(gate.user.key),
    fetchProjects(),
    fetchMyTasks(gate.user.key),
  ]);
  return NextResponse.json({ ...status, projects, tasks });
}
