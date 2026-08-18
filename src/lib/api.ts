/**
 * Client fetch helper (same contract as the main app's lib/api.ts), plus the
 * basePath prefix — fetch() is NOT basePath-aware, unlike <Link>.
 */

export const BASE_PATH = "/clock";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_PATH}${path}`, {
      cache: "no-store",
      ...init,
      headers:
        init?.body != null
          ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
          : init?.headers,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const err =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error)
          : null) ?? `Request failed (${res.status})`;
      return { ok: false, error: err };
    }
    return { ok: true, data: parsed as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body == null ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
