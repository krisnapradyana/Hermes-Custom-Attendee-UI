import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { clockOut } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const closed = await clockOut(gate.user.key);
  return NextResponse.json({ closed });
}
