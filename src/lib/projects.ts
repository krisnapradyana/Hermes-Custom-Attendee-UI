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

let cache: { at: number; list: TcProject[] } | null = null;
const TTL = 60_000;

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
