"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  Clock,
  LogOut,
  Play,
  Square,
  ArrowLeftRight,
  FolderKanban,
  ListChecks,
  CornerDownRight,
  Send,
} from "lucide-react";
import { api } from "@/lib/api";
import { TcProject, TcTask } from "@/lib/projects";

/**
 * The clock. One glance = my status, one tap = in or out.
 * Mobile-first: single column, ≥48px touch targets, timer readable at
 * arm's length. State A (out): project cards with big clock-in buttons.
 * State B (in): the active card dominates; others offer "Switch here".
 */

interface Me {
  active: { projectId: string; inAt: string } | null;
  week: { projectId: string; ms: number }[];
  /** Projects I have ever clocked time in. */
  touched: string[];
  projects: TcProject[];
  tasks: TcTask[];
}

const fmtDur = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtTimer = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = String(Math.floor((ms % 3600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export default function ClockPage() {
  const { data: session } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 1s tick drives the live timer and the header clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const res = await api.get<Me>("/api/timeclock/me");
    if (res.ok) {
      setMe(res.data);
      setError("");
    } else setError(res.error);
  }, []);

  useEffect(() => {
    load();
    // Refresh when the phone comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const weekByProject = useMemo(
    () => new Map((me?.week ?? []).map((w) => [w.projectId, w.ms])),
    [me]
  );

  // "My" projects = assigned via a task, created by me, worked in before,
  // or currently active. Everything else hides under "Other projects".
  const { mineProjects, otherProjects } = useMemo(() => {
    const list = [...(me?.projects ?? [])].sort(
      (a, b) =>
        (weekByProject.get(b.id) ?? 0) - (weekByProject.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name)
    );
    const mine = new Set<string>(me?.touched ?? []);
    for (const t of me?.tasks ?? []) mine.add(t.projectId);
    if (me?.active) mine.add(me.active.projectId);
    const myKey = session?.user?.slackId ?? "local";
    for (const p of list) if (p.createdBy && p.createdBy === myKey) mine.add(p.id);
    return {
      mineProjects: list.filter((p) => mine.has(p.id)),
      otherProjects: list.filter((p) => !mine.has(p.id)),
    };
  }, [me, weekByProject, session]);
  const [showOthers, setShowOthers] = useState(false);

  // A task tapped via "Start" — marked as doing once the clock-in succeeds
  // (including after the switch-project confirmation).
  const [pendingTask, setPendingTask] = useState<TcTask | null>(null);

  const clockIn = async (projectId: string, force = false) => {
    if (busy || !me) return;
    setBusy(true);
    setConfirmSwitch(null);
    const prev = me;
    // Optimistic flip; revert on failure.
    setMe({ ...me, active: { projectId, inAt: new Date().toISOString() } });
    const res = await api.post<{
      active?: { projectId: string; inAt: string };
      needSwitch?: boolean;
    }>("/api/timeclock/in", { projectId, switch: force });
    if (!res.ok) {
      setMe(prev);
      setError(res.error);
      setPendingTask(null);
    } else if (res.data.needSwitch) {
      setMe(prev);
      setConfirmSwitch(projectId);
    } else if (res.data.active) {
      setMe({ ...prev, active: res.data.active });
      if (pendingTask && pendingTask.projectId === projectId) {
        await api.post("/api/timeclock/task", {
          projectId,
          taskId: pendingTask.id,
          status: "doing",
        });
        setPendingTask(null);
      }
      load(); // refresh weekly totals + tasks
    }
    setBusy(false);
  };

  /** Tap a task: clock into its project and mark it doing. */
  const startTask = (t: TcTask) => {
    setPendingTask(t);
    clockIn(t.projectId);
  };

  /** Hand a doing-task to the PM for review. */
  const sendToReview = async (t: TcTask) => {
    const res = await api.post("/api/timeclock/task", {
      projectId: t.projectId,
      taskId: t.id,
      status: "review",
    });
    if (!res.ok) setError((res as { error: string }).error);
    load();
  };

  const clockOut = async () => {
    if (busy || !me?.active) return;
    setBusy(true);
    const prev = me;
    setMe({ ...me, active: null });
    const res = await api.post("/api/timeclock/out");
    if (!res.ok) {
      setMe(prev);
      setError(res.error);
    } else load();
    setBusy(false);
  };

  const activeProject = me?.active
    ? me.projects.find((p) => p.id === me.active!.projectId)
    : undefined;
  const elapsed = me?.active ? Math.max(0, now - Date.parse(me.active.inAt)) : 0;

  return (
    <div className="mx-auto max-w-md px-4 py-6 min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-6">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <Clock size={17} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif-display text-xl leading-tight">Clock</h1>
          <p className="text-[12px] text-ink-faint" suppressHydrationWarning>
            {new Date(now).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        </div>
        {me?.active && (
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-ink-soft">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Working
          </span>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!me && !error && <p className="text-sm text-ink-faint py-10 text-center">Loading…</p>}

      {/* Active session — dominates the screen. */}
      {me?.active && (
        <div className="mb-5 rounded-2xl border-2 border-accent bg-card p-5 shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <FolderKanban size={15} style={{ color: activeProject?.color }} />
            <p className="font-medium truncate">{activeProject?.name ?? me.active.projectId}</p>
          </div>
          <p
            className="font-mono text-4xl font-semibold tracking-tight my-3 tabular-nums"
            suppressHydrationWarning
          >
            {fmtTimer(elapsed)}
          </p>
          <button
            onClick={clockOut}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-white font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <Square size={16} />
            Clock out
          </button>
        </div>
      )}

      {/* My tasks — assigned in the assistant, actionable here. */}
      {me && me.tasks.length > 0 && (
        <div className="mb-6">
          <h2 className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-faint mb-2.5">
            <ListChecks size={13} />
            My tasks · {me.tasks.length}
          </h2>
          <div className="space-y-2">
            {me.tasks.map((t) => {
              const proj = me.projects.find((p) => p.id === t.projectId);
              return (
                <div key={t.id} className="rounded-xl border border-line bg-card px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium truncate">{t.title}</p>
                      <p className="text-[11px] text-ink-faint truncate">
                        {proj?.name ?? t.projectId}
                        {t.phase ? ` · ${t.phase}` : ""}
                        {t.dueDate
                          ? ` · due ${new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(
                              undefined,
                              { day: "numeric", month: "short" }
                            )}`
                          : ""}{" "}
                        ·{" "}
                        <span
                          className={
                            t.status === "revision"
                              ? "text-red-500"
                              : t.status === "review"
                                ? "text-amber-500"
                                : t.status === "doing"
                                  ? "text-accent"
                                  : ""
                          }
                        >
                          {t.status}
                        </span>
                      </p>
                    </div>
                    {t.status === "doing" ? (
                      <button
                        onClick={() => sendToReview(t)}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] text-ink-soft hover:border-ink-faint hover:text-ink disabled:opacity-50 shrink-0"
                      >
                        <Send size={12} />
                        To review
                      </button>
                    ) : (
                      <button
                        onClick={() => startTask(t)}
                        disabled={busy || t.status === "review"}
                        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] text-white hover:bg-accent-hover disabled:opacity-40 shrink-0"
                      >
                        <Play size={12} />
                        Start
                      </button>
                    )}
                  </div>
                  {t.status === "revision" && t.statusNote && (
                    <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ink-soft rounded-lg bg-parchment-dark px-2.5 py-1.5">
                      <CornerDownRight size={11} className="mt-0.5 shrink-0 text-red-500" />
                      {t.statusNote}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Projects — mine first; everything else behind a toggle. */}
      <div className="space-y-3 flex-1">
        {(showOthers ? [...mineProjects, ...otherProjects] : mineProjects).map((p) => {
          const isActive = me?.active?.projectId === p.id;
          if (isActive) return null;
          const weekMs = weekByProject.get(p.id) ?? 0;
          const confirming = confirmSwitch === p.id;

          return (
            <div
              key={p.id}
              className={`rounded-2xl border border-line bg-card p-4 ${
                me?.active ? "opacity-80" : ""
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${p.color}22` }}
                >
                  <FolderKanban size={14} style={{ color: p.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[15px] truncate">{p.name}</p>
                  <p className="text-[12px] text-ink-faint">
                    {weekMs > 0 ? `${fmtDur(weekMs)} this week` : "No time this week"}
                  </p>
                </div>
                {!me?.active ? (
                  <button
                    onClick={() => clockIn(p.id)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-3 text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
                  >
                    <Play size={14} />
                    Clock in
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmSwitch(confirming ? null : p.id)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-[13px] text-ink-soft hover:border-ink-faint hover:text-ink disabled:opacity-50 transition-colors shrink-0"
                  >
                    <ArrowLeftRight size={13} />
                    Switch here
                  </button>
                )}
              </div>

              {confirming && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-parchment-dark px-3 py-2.5">
                  <p className="flex-1 text-[13px] text-ink-soft">
                    Clock out of{" "}
                    <span className="font-medium text-ink">
                      {activeProject?.name ?? "current project"}
                    </span>{" "}
                    and start here?
                  </p>
                  <button
                    onClick={() => clockIn(p.id, true)}
                    className="rounded-lg bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-hover"
                  >
                    Switch
                  </button>
                  <button
                    onClick={() => {
                      setConfirmSwitch(null);
                      setPendingTask(null);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-card"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {otherProjects.length > 0 && (
          <button
            onClick={() => setShowOthers(!showOthers)}
            className="w-full text-center text-[12px] text-ink-faint hover:text-ink py-2 transition-colors"
          >
            {showOthers ? "Hide other projects" : `Show other projects · ${otherProjects.length}`}
          </button>
        )}

        {me && mineProjects.length === 0 && otherProjects.length === 0 && (
          <p className="text-sm text-ink-faint text-center py-10">
            No projects yet — create one in the SuperPixel Assistant first.
          </p>
        )}
        {me && mineProjects.length === 0 && otherProjects.length > 0 && !showOthers && (
          <p className="text-sm text-ink-faint text-center py-6">
            No projects assigned to you yet — ask your PM for a task, or pick from other projects
            above.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 flex items-center justify-between text-[12px] text-ink-faint">
        <span className="truncate">{session?.user?.name ?? ""}</span>
        {process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && (
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1 hover:text-ink transition-colors shrink-0"
          >
            <LogOut size={12} />
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
