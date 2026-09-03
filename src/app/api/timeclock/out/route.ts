import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { clockOut } from "@/lib/timeclock";
import { syncClear } from "@/lib/slack-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const closed = await clockOut(gate.user.key);
  if (closed) syncClear(gate.user.key); // opt-in Slack mirror, fire-and-forget
  return NextResponse.json({ closed });
}
