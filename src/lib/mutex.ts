/**
 * Minimal in-process async mutex, keyed by resource name. This app is the
 * ONLY writer of timeclock data (single-writer principle — the main app
 * reads over HTTP), so an in-process lock is sufficient.
 */

const queues = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(
    key,
    run.catch(() => {})
  );
  return run;
}
