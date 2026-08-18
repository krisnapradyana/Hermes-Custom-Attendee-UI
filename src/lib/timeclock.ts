import { promises as fs } from "fs";
import path from "path";
import { withLock } from "./mutex";
import { TcUser } from "./user-key";

/**
 * Timeclock storage. One JSON file of sessions per project plus an
 * active-session index, all mutated under a single lock so a clock-in that
 * switches projects is atomic (one close + one open, never two actives).
 *
 * Times are stored ISO UTC. "Today"/"this week" boundaries use a fixed studio
 * timezone offset (TIMECLOCK_TZ_OFFSET_MIN, default 480 = UTC+8 WITA) so the
 * numbers match the wall clock at the studio, not the server.
 */

export interface TcSession {
  id: string;
  userKey: string;
  name: string;
  slackId?: string;
  inAt: string; // ISO UTC
  outAt: string | null;
  autoClosed?: boolean;
}

export interface MemberAggregate {
  userKey: string;
  name: string;
  todayMs: number;
  weekMs: number;
  sessions: number;
  lastSeen: string; // ISO — latest inAt/outAt
  activeSince?: string; // set when clocked in right now
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "timeclock");
const ACTIVE = path.join(DIR, "active.json");
const AUTO_CLOSE_MS = 12 * 3600_000;
const LOCK = "timeclock";
const OFFSET_MIN = Number(process.env.TIMECLOCK_TZ_OFFSET_MIN ?? "480");

type ActiveIndex = Record<string, { projectId: string; sessionId: string; inAt: string }>;

const projFile = (projectId: string) =>
  path.join(DIR, `${projectId.replace(/[^\w.-]+/g, "_")}.json`);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

/** Close sessions forgotten open for 12h+. Runs inside the lock. */
async function sweep(): Promise<ActiveIndex> {
  const active = await readJson<ActiveIndex>(ACTIVE, {});
  const now = Date.now();
  let dirty = false;
  for (const [userKey, a] of Object.entries(active)) {
    if (now - Date.parse(a.inAt) < AUTO_CLOSE_MS) continue;
    const file = projFile(a.projectId);
    const sessions = await readJson<TcSession[]>(file, []);
    const s = sessions.find((x) => x.id === a.sessionId);
    if (s && !s.outAt) {
      s.outAt = new Date(Date.parse(a.inAt) + AUTO_CLOSE_MS).toISOString();
      s.autoClosed = true;
      await writeAtomic(file, sessions);
    }
    delete active[userKey];
    dirty = true;
  }
  if (dirty) await writeAtomic(ACTIVE, active);
  return active;
}

// ---- day/week boundaries in studio time ----------------------------------

const DAY = 86_400_000;
const off = OFFSET_MIN * 60_000;

export function dayStart(now = Date.now()): number {
  return Math.floor((now + off) / DAY) * DAY - off;
}

export function weekStart(now = Date.now()): number {
  const days = Math.floor((now + off) / DAY);
  const dowMon0 = (days + 3) % 7; // epoch day 0 = Thursday
  return (days - dowMon0) * DAY - off;
}

/** ms of a session that fall inside [from, to). Open sessions count to now. */
function overlap(s: TcSession, from: number, to: number): number {
  const a = Math.max(Date.parse(s.inAt), from);
  const b = Math.min(s.outAt ? Date.parse(s.outAt) : Date.now(), to);
  return Math.max(0, b - a);
}

// ---- mutations -------------------------------------------------------------

export type ClockInResult =
  { ok: true; projectId: string; inAt: string } | { conflict: { projectId: string; inAt: string } };

export function clockIn(user: TcUser, projectId: string, force: boolean): Promise<ClockInResult> {
  return withLock(LOCK, async () => {
    const active = await sweep();
    const cur = active[user.key];

    // Idempotent: already clocked in HERE → same session, no duplicate.
    if (cur && cur.projectId === projectId) {
      return { ok: true as const, projectId, inAt: cur.inAt };
    }
    if (cur && !force) {
      return { conflict: { projectId: cur.projectId, inAt: cur.inAt } };
    }
    if (cur) {
      // Switch: close the other project's session in the same lock hold.
      const file = projFile(cur.projectId);
      const sessions = await readJson<TcSession[]>(file, []);
      const s = sessions.find((x) => x.id === cur.sessionId);
      if (s && !s.outAt) {
        s.outAt = new Date().toISOString();
        await writeAtomic(file, sessions);
      }
    }

    const inAt = new Date().toISOString();
    const session: TcSession = {
      id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userKey: user.key,
      name: user.name,
      slackId: user.slackId,
      inAt,
      outAt: null,
    };
    const file = projFile(projectId);
    const sessions = await readJson<TcSession[]>(file, []);
    sessions.push(session);
    await writeAtomic(file, sessions);
    active[user.key] = { projectId, sessionId: session.id, inAt };
    await writeAtomic(ACTIVE, active);
    return { ok: true as const, projectId, inAt };
  });
}

export function clockOut(userKey: string): Promise<{ projectId: string; ms: number } | null> {
  return withLock(LOCK, async () => {
    const active = await sweep();
    const cur = active[userKey];
    if (!cur) return null;
    const file = projFile(cur.projectId);
    const sessions = await readJson<TcSession[]>(file, []);
    const s = sessions.find((x) => x.id === cur.sessionId);
    let ms = 0;
    if (s && !s.outAt) {
      s.outAt = new Date().toISOString();
      ms = Date.parse(s.outAt) - Date.parse(s.inAt);
      await writeAtomic(file, sessions);
    }
    delete active[userKey];
    await writeAtomic(ACTIVE, active);
    return { projectId: cur.projectId, ms };
  });
}

export function deleteSession(
  userKey: string,
  projectId: string,
  sessionId: string
): Promise<boolean> {
  return withLock(LOCK, async () => {
    const file = projFile(projectId);
    const sessions = await readJson<TcSession[]>(file, []);
    const s = sessions.find((x) => x.id === sessionId);
    // Owner-only, closed sessions only, younger than 24h.
    if (!s || s.userKey !== userKey || !s.outAt) return false;
    if (Date.now() - Date.parse(s.inAt) > 24 * 3600_000) return false;
    await writeAtomic(
      file,
      sessions.filter((x) => x.id !== sessionId)
    );
    return true;
  });
}

// ---- reads -----------------------------------------------------------------

export function myStatus(userKey: string): Promise<{
  active: { projectId: string; inAt: string } | null;
  week: { projectId: string; ms: number }[];
}> {
  return withLock(LOCK, async () => {
    const active = await sweep();
    const cur = active[userKey] ?? null;

    const from = weekStart();
    const week: { projectId: string; ms: number }[] = [];
    let files: string[] = [];
    try {
      files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json") && f !== "active.json");
    } catch {}
    for (const f of files) {
      const sessions = await readJson<TcSession[]>(path.join(DIR, f), []);
      const mine = sessions.filter((s) => s.userKey === userKey);
      const ms = mine.reduce((acc, s) => acc + overlap(s, from, Date.now()), 0);
      if (ms > 0) week.push({ projectId: f.replace(/\.json$/, ""), ms });
    }
    return { active: cur ? { projectId: cur.projectId, inAt: cur.inAt } : null, week };
  });
}

export function projectReport(projectId: string): Promise<{
  members: MemberAggregate[];
  history: TcSession[]; // last 30 days, newest first
}> {
  return withLock(LOCK, async () => {
    const active = await sweep();
    const sessions = await readJson<TcSession[]>(projFile(projectId), []);
    const dFrom = dayStart();
    const wFrom = weekStart();
    const now = Date.now();

    const byUser = new Map<string, MemberAggregate>();
    for (const s of sessions) {
      const m = byUser.get(s.userKey) ?? {
        userKey: s.userKey,
        name: s.name,
        todayMs: 0,
        weekMs: 0,
        sessions: 0,
        lastSeen: s.inAt,
      };
      m.name = s.name; // latest name wins
      m.todayMs += overlap(s, dFrom, now);
      m.weekMs += overlap(s, wFrom, now);
      m.sessions += 1;
      const seen = s.outAt ?? s.inAt;
      if (seen > m.lastSeen) m.lastSeen = seen;
      byUser.set(s.userKey, m);
    }
    for (const [userKey, a] of Object.entries(active)) {
      if (a.projectId === projectId) {
        const m = byUser.get(userKey);
        if (m) m.activeSince = a.inAt;
      }
    }

    const cutoff = now - 30 * DAY;
    const history = sessions
      .filter((s) => Date.parse(s.inAt) >= cutoff)
      .sort((a, b) => b.inAt.localeCompare(a.inAt));

    const members = [...byUser.values()].sort((a, b) => b.weekMs - a.weekMs);
    return { members, history };
  });
}

export interface MemberPulse {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string } | null;
  todayMs: number;
  weekMs: number;
  lastSeen: string | null; // ISO — latest activity ever (null = never clocked)
  weekByProject: { projectId: string; ms: number }[];
}

/**
 * Whole-team snapshot for the PM's Team Pulse page: who is working right
 * now (and on what, since when), who is idle, and everyone's hours today
 * and this week. One pass over all project files.
 */
export function overview(): Promise<MemberPulse[]> {
  return withLock(LOCK, async () => {
    const active = await sweep();
    const dFrom = dayStart();
    const wFrom = weekStart();
    const now = Date.now();

    const members = new Map<string, MemberPulse>();
    let files: string[] = [];
    try {
      files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json") && f !== "active.json");
    } catch {}

    for (const f of files) {
      const projectId = f.replace(/\.json$/, "");
      const sessions = await readJson<TcSession[]>(path.join(DIR, f), []);
      for (const s of sessions) {
        const m = members.get(s.userKey) ?? {
          userKey: s.userKey,
          name: s.name,
          active: null,
          todayMs: 0,
          weekMs: 0,
          lastSeen: null,
          weekByProject: [],
        };
        m.name = s.name; // latest name wins
        m.todayMs += overlap(s, dFrom, now);
        const w = overlap(s, wFrom, now);
        m.weekMs += w;
        if (w > 0) {
          const entry = m.weekByProject.find((x) => x.projectId === projectId);
          if (entry) entry.ms += w;
          else m.weekByProject.push({ projectId, ms: w });
        }
        const seen = s.outAt ?? s.inAt;
        if (!m.lastSeen || seen > m.lastSeen) m.lastSeen = seen;
        members.set(s.userKey, m);
      }
    }

    for (const [userKey, a] of Object.entries(active)) {
      const m = members.get(userKey);
      if (m) m.active = { projectId: a.projectId, inAt: a.inAt };
    }

    // Working people first, then most recently seen.
    return [...members.values()].sort((a, b) => {
      if (!!a.active !== !!b.active) return a.active ? -1 : 1;
      return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    });
  });
}

export function allSessions(projectId: string): Promise<TcSession[]> {
  return withLock(LOCK, async () => {
    await sweep();
    return readJson<TcSession[]>(projFile(projectId), []);
  });
}

/** "2026-08-18 14:05" in studio time — for the CSV export. */
export function studioTime(iso: string): string {
  return new Date(Date.parse(iso) + off).toISOString().slice(0, 16).replace("T", " ");
}
