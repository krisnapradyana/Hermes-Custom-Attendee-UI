import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireUser } from "@/lib/user-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kick off the one-time Slack grant for status sync. Same Slack app as
 * sign-in; user scopes only (a bot can't set personal statuses).
 */
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const clientId = process.env.AUTH_SLACK_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Slack app not configured" }, { status: 500 });
  }
  const base = (process.env.AUTH_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const state = randomBytes(16).toString("hex");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("user_scope", "users.profile:write,users.profile:read");
  url.searchParams.set("redirect_uri", `${base}/api/slack-status/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("attendee.slack-status-state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https"),
    path: "/",
    maxAge: 600,
  });
  return res;
}
