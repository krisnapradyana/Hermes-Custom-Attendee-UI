import { auth } from "@/auth";

/**
 * Server-side auth gate for the API. Public: the sign-in flow itself and the
 * container healthcheck. Requests carrying an internal token header pass the
 * wall so the main app can read sessions server-to-server — the route itself
 * validates the token value (see user-key.ts).
 */

const PUBLIC_API = [/^\/api\/auth(\/|$)/, /^\/api\/health$/];

export default auth((req) => {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") return;

  const { pathname } = req.nextUrl;
  if (PUBLIC_API.some((re) => re.test(pathname))) return;
  if (req.headers.get("x-internal-token")) return; // validated in the route

  if (!req.auth?.user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
});

export const config = {
  matcher: ["/api/:path*"],
};
