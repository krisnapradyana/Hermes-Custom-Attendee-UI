/**
 * Project list, fetched from the MAIN assistant app (which owns
 * projects.json — single writer) over the internal Docker network.
 * Cached 60s; on failure the last good list is served so the clock page
 * keeps working through a main-app redeploy.
 */

export interface TcProject {
  id: string;
  name: string;
  color: string;
}

export type TaskStatus = "todo" | "doing" | "review" | "revision" | "done";

export interface TcTask {
  id: string;
  projectId: string;
  title: string;
  phase?: string;
  status: TaskStatus;
  statusNote?: string;
  updatedAt: string;
}

let cache: { at: number; list: TcProject[] } | null = null;
const TTL = 60_000;

const mainApp = () => {
  const base = process.env.MAIN_APP_URL;
  const token = process.env.INTERNAL_TOKEN;
  if (!base || !token) return null;
  return { base: base.replace(/\/$/, ""), token };
};

/** My open tasks, straight from the main app (which owns tasks). */
export async function fetchMyTasks(userKey: string): Promise<TcTask[]> {
  const cfg = mainApp();
  if (!cfg) return [];
  try {
    const res = await fetch(
      `${cfg.base}/api/internal/tasks?assignee=${encodeURIComponent(userKey)}`,
      {
        headers: { "x-internal-token": cfg.token },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return [];
    return ((await res.json()) as { tasks: TcTask[] }).tasks;
  } catch {
    return [];
  }
}

/** Flip a task's status on the member's behalf (assignee-checked upstream). */
export async function setTaskStatus(
  userKey: string,
  projectId: string,
  taskId: string,
  status: TaskStatus
): Promise<boolean> {
  const cfg = mainApp();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.base}/api/internal/tasks/status`, {
      method: "POST",
      headers: { "x-internal-token": cfg.token, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, taskId, userKey, status }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchProjects(): Promise<TcProject[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.list;

  const base = process.env.MAIN_APP_URL;
  const token = process.env.INTERNAL_TOKEN;
  if (!base || !token) {
    console.warn("[projects] MAIN_APP_URL / INTERNAL_TOKEN not set");
    return cache?.list ?? [];
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/internal/projects`, {
      headers: { "x-internal-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`main app answered ${res.status}`);
    const { projects } = (await res.json()) as { projects: TcProject[] };
    cache = { at: Date.now(), list: projects };
    return projects;
  } catch (err) {
    console.warn(`[projects] fetch failed: ${err instanceof Error ? err.message : err}`);
    return cache?.list ?? [];
  }
}
