import NextAuth from "next-auth";
import Slack from "next-auth/providers/slack";

/**
 * Same Slack OIDC app as the main assistant — one extra redirect URI:
 *   https://<domain>/clock/api/auth/callback/slack
 *
 * Every cookie gets an "attendee." prefix: both apps share the domain, and
 * next-auth's default cookie names would collide with the main app's session.
 */

const secure = (process.env.AUTH_URL ?? "").startsWith("https");
const opts = { httpOnly: true, sameSite: "lax" as const, path: "/", secure };

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Slack],
  trustHost: true,
  basePath: "/clock/api/auth",
  cookies: {
    sessionToken: { name: "attendee.session-token", options: opts },
    callbackUrl: { name: "attendee.callback-url", options: { ...opts, httpOnly: false } },
    csrfToken: { name: "attendee.csrf-token", options: opts },
    pkceCodeVerifier: { name: "attendee.pkce.code_verifier", options: { ...opts, maxAge: 900 } },
    state: { name: "attendee.state", options: { ...opts, maxAge: 900 } },
    nonce: { name: "attendee.nonce", options: opts },
  },
  callbacks: {
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
