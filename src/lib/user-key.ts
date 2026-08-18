import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export interface TcUser {
  key: string; // storage/identity key (Slack user id)
  name: string; // display name for session records
  slackId?: string;
}

/** The one auth guard for API routes (same pattern as the main app). */
export async function requireUser(): Promise<
  { user: TcUser; denied?: undefined } | { user?: undefined; denied: NextResponse }
> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") {
    return { user: { key: "local", name: "Local User" } };
  }
  try {
    const session = await auth();
    const slackId = session?.user?.slackId;
    if (!slackId) throw new Error("no session");
    return {
      user: { key: slackId, name: session?.user?.name ?? "Member", slackId },
    };
  } catch {
    return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
}

/** True when the request carries the valid server-to-server token. */
export function internalOk(req: NextRequest): boolean {
  const token = process.env.INTERNAL_TOKEN;
  return !!token && req.headers.get("x-internal-token") === token;
}
