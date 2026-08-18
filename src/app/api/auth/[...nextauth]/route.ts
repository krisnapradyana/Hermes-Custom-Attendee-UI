import { handlers } from "@/auth";

// next-auth's HTTP surface (signin, callback, csrf, session, …).
// Without this file the whole /api/auth/* tree 404s and sign-in is impossible.
export const { GET, POST } = handlers;
