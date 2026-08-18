import { NextRequest, NextResponse } from "next/server";
import { requireUser, internalOk } from "@/lib/user-key";
import { allSessions, studioTime } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** All sessions as CSV (studio-local times). Opens straight in Sheets. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!internalOk(req)) {
    const gate = await requireUser();
    if (gate.denied) return gate.denied;
  }

  const sessions = await allSessions(projectId);
  const rows = [
    "member,slack_id,clock_in,clock_out,duration_hours,auto_closed",
    ...sessions.map((s) => {
      const out = s.outAt ? studioTime(s.outAt) : "";
      const dur = s.outAt ? ((Date.parse(s.outAt) - Date.parse(s.inAt)) / 3600_000).toFixed(2) : "";
      return [
        esc(s.name),
        s.slackId ?? "",
        studioTime(s.inAt),
        out,
        dur,
        s.autoClosed ? "yes" : "",
      ].join(",");
    }),
  ];

  return new NextResponse(rows.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timeclock-${projectId}.csv"`,
    },
  });
}
