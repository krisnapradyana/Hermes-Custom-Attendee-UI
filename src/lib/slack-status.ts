import { promises as fs } from "fs";
import path from "path";

/**
 * Slack status sync — opt-in, per member. The Clock is the source of truth:
 * clock in → 🎬 "Working · <project>", break → ☕ "On a break", resume →
 * working again, clock out → cleared.
 *
 * Slack only lets a USER token set that user's status (a bot can't), so each
 * member authorizes once via OAuth (same Slack app as sign-in, extra user
 * scopes users.profile:write + users.profile:read). Tokens live in the data
 * volume next to the session files — never in git.
 *
 * Two safety rules, learned from every status-bot that people ended up
 * hating:
 *  1. NEVER clobber a human-set status. We only write when the current
 *     status is empty or one we wrote ourselves (recognized by our emoji).
 *  2. Every status carries an expiration (13h — just past the 12h
 *     auto-close sweep), so a dead server can't leave "Working" up forever.
 *
 * All calls are fire-and-forget from the clock paths: a Slack hiccup must
 * never fail or slow a clock action.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "slack-status");

const WORKING_EMOJI = ":clapper:";
const BREAK_EMOJI = ":coffee:";
const STANDBY_EMOJI = ":seat:";
const GENERAL_EMOJI = ":office:";
const OUR_EMOJI = new Set([WORKING_EMOJI, BREAK_EMOJI, STANDBY_EMOJI, GENERAL_EMOJI]);
const EXPIRATION_MS = 13 * 3600_000;
/** Breaks are short by nature — the status clears itself after 2h even if
 * the person forgets to resume, so Slack never shows a stale all-day break. */
const BREAK_EXPIRATION_MS = 2 * 3600_000;

interface TokenFile {
  accessToken: string;
  slackUserId: string;
  savedAt: string;
}

const tokenPath = (userKey: string) =>
  path.join(DIR, `${userKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

export async function readToken(userKey: string): Promise<TokenFile | null> {
  try {
    return JSON.parse(await fs.readFile(tokenPath(userKey), "utf-8")) as TokenFile;
  } catch {
    return null;
  }
}

export async function saveToken(userKey: string, token: TokenFile): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(tokenPath(userKey), JSON.stringify(token, null, 2));
}

export async function deleteToken(userKey: string): Promise<void> {
  try {
    await fs.unlink(tokenPath(userKey));
  } catch {}
}

export async function isConnected(userKey: string): Promise<boolean> {
  return (await readToken(userKey)) !== null;
}

// ---- Slack API ------------------------------------------------------------

async function slackApi<T>(
  method: string,
  token: string,
  body?: Record<string, unknown>
): Promise<(T & { ok: boolean; error?: string }) | null> {
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json; charset=utf-8" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    return (await res.json()) as T & { ok: boolean; error?: string };
  } catch {
    return null;
  }
}

interface ProfileResp {
  profile?: { status_text?: string; status_emoji?: string };
}

/** May we overwrite the current status? Empty or ours = yes; human's = no.
 * If we can't READ the status, we don't write either — clobbering a
 * human-set status is worse than missing a sync. */
async function mayWrite(token: string): Promise<boolean> {
  const cur = await slackApi<ProfileResp>("users.profile.get", token);
  if (!cur?.ok) return false;
  const emoji = cur.profile?.status_emoji ?? "";
  const text = cur.profile?.status_text ?? "";
  return (!emoji && !text) || OUR_EMOJI.has(emoji);
}

async function setStatus(
  userKey: string,
  status: { text: string; emoji: string; expiresMs?: number } | null
): Promise<void> {
  const tok = await readToken(userKey);
  if (!tok) return; // not opted in — nothing to do

  if (!(await mayWrite(tok.accessToken))) return; // human-set status — hands off

  const res = await slackApi<Record<string, never>>("users.profile.set", tok.accessToken, {
    profile: status
      ? {
          status_text: status.text.slice(0, 100),
          status_emoji: status.emoji,
          status_expiration: Math.floor(
            (Date.now() + (status.expiresMs ?? EXPIRATION_MS)) / 1000
          ),
        }
      : { status_text: "", status_emoji: "" },
  });
  if (res && !res.ok && (res.error === "token_revoked" || res.error === "invalid_auth")) {
    await deleteToken(userKey); // user revoked in Slack — stop trying
  }
}

// ---- fire-and-forget entry points (never throw, never block) ---------------

const quiet = (p: Promise<void>) =>
  void p.catch((err) => console.warn(`[slack-status] ${err instanceof Error ? err.message : err}`));

export function syncWorking(userKey: string, projectName?: string): void {
  quiet(
    setStatus(userKey, {
      text: projectName ? `Working · ${projectName}` : "Working",
      emoji: WORKING_EMOJI,
    })
  );
}

export function syncBreak(userKey: string): void {
  quiet(
    setStatus(userKey, { text: "On a break", emoji: BREAK_EMOJI, expiresMs: BREAK_EXPIRATION_MS })
  );
}

export function syncStandby(userKey: string): void {
  quiet(setStatus(userKey, { text: "Standby", emoji: STANDBY_EMOJI }));
}

export function syncGeneral(userKey: string): void {
  quiet(setStatus(userKey, { text: "General duty", emoji: GENERAL_EMOJI }));
}

export function syncClear(userKey: string): void {
  quiet(setStatus(userKey, null));
}
