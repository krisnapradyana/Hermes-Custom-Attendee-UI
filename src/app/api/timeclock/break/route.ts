import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { toggleBreak } from "@/lib/timeclock";

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
  return NextResponse.json(result);
}
