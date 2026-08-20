import NextAuth from "next-auth";
import Slack from "next-auth/providers/slack";

/**
 * Same Slack OIDC app as the main assistant — one extra redirect URI:
 *   https://clock.<domain>/api/auth/callback/slack
 *
 * Cookies keep an "attendee." prefix anyway: cookies are host-scoped so the
 * subdomain isolates them already, but the prefix keeps things unambiguous
 * if this app is ever served next to the main one again.
 */

const secure = (process.env.AUTH_URL ?? "").startsWith("https");
const opts = { httpOnly: true, sameSite: "lax" as const, path: "/", secure };

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Slack],
  trustHost: true,
  cookies: {
    sessionToken: { name: "attendee.session-token", options: opts },
    callbackUrl: { name: "attendee.callback-url", options: { ...opts, httpOnly: false } },
    csrfToken: { name: "attendee.csrf-token", options: opts },
    pkceCodeVerifier: { name: "attendee.pkce.code_verifier", options: { ...opts, maxAge: 900 } },
    state: { name: "attendee.state", options: { ...opts, maxAge: 900 } },
    nonce: { name: "attendee.nonce", options: opts },
  },
  callbacks: {
    /** Workspace lock — see the main app: enforced only when SLACK_TEAM_ID is set. */
    signIn({ profile }) {
      const requiredTeam = process.env.SLACK_TEAM_ID;
      if (!requiredTeam) return true;
      return (profile?.["https://slack.com/team_id"] as string | undefined) === requiredTeam;
    },
    jwt({ token, profile }) {
      if (profile) {
        token.slackId =
          (profile["https://slack.com/user_id"] as string | undefined) ?? profile.sub ?? undefined;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.slackId = token.slackId as string | undefined;
      }
      return session;
    },
  },
});
