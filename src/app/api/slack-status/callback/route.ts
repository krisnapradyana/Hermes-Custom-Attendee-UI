import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { saveToken } from "@/lib/slack-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth callback: exchange the code, verify the granting Slack user IS the
 * signed-in member (no linking someone else's account), store the token.
 */
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  // Same base derivation as /connect — redirect_uri must match EXACTLY.
  const base = (process.env.AUTH_URL ?? req.nextUrl.origin)
    .replace(/\/api\/auth\/?$/, "")
    .replace(/\/$/, "");
  const back = (q: string) => NextResponse.redirect(`${base}/?slack=${q}`);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("attendee.slack-status-state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) return back("error");

  const clientId = process.env.AUTH_SLACK_ID;
  const clientSecret = process.env.AUTH_SLACK_SECRET;
  if (!clientId || !clientSecret) return back("error");

  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${base}/api/slack-status/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as {
      ok: boolean;
      error?: string;
      authed_user?: { id?: string; access_token?: string; scope?: string };
    };
    const u = j.authed_user;
    if (!j.ok || !u?.access_token || !u.id) {
      console.warn(`[slack-status] oauth exchange failed: ${j.error}`);
      return back("error");
    }
    // The Slack account that granted must be the member who is signed in.
    if (u.id !== gate.user.key) return back("mismatch");
    if (!(u.scope ?? "").includes("users.profile:write")) return back("error");

    await saveToken(gate.user.key, {
      accessToken: u.access_token,
      slackUserId: u.id,
      savedAt: new Date().toISOString(),
    });
    const out = back("connected");
    out.cookies.delete("attendee.slack-status-state");
    return out;
  } catch (err) {
    console.warn(`[slack-status] callback error: ${err instanceof Error ? err.message : err}`);
    return back("error");
  }
}
