import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { isConnected, deleteToken, syncClear } from "@/lib/slack-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Am I synced? */
export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  return NextResponse.json({ connected: await isConnected(gate.user.key) });
}

/** Stop syncing: clear any status we set, then forget the token. */
export async function DELETE() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  syncClear(gate.user.key); // best-effort, before the token disappears
  // Small grace so the clear can use the token; deletion is idempotent anyway.
  setTimeout(() => void deleteToken(gate.user.key), 3_000);
  return NextResponse.json({ ok: true });
}
