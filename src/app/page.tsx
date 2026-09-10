"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  LogOut,
  Play,
  Square,
  ArrowLeftRight,
  FolderKanban,
  ListChecks,
  CornerDownRight,
  Send,
  Coffee,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Armchair,
  Sun,
  Moon,
} from "lucide-react";
import { api } from "@/lib/api";
import { TcProject, TcTask } from "@/lib/projects";

/** Pseudo-project id for "present, no project" — see lib/timeclock.ts. */
const STANDBY_ID = "standby";

/**
 * The clock — UI-refresh "hero" layout (approved mock): the day-total timer
 * IS the app. Wordmark + theme toggle up top, giant timer with the active
 * project's own count under it, round action buttons, then glass cards for
 * "My tasks here" and the "Switch to" project list with inline ice-glass
 * switch confirmation. All clock logic is unchanged from v1.
 */

interface Me {
  active: { projectId: string; inAt: string; breakAt?: string; breakMs?: number } | null;
  week: { projectId: string; ms: number }[];
  today: { projectId: string; ms: number }[];
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

/** Exact wordmark from the main app: pixel-cluster x, "Clock" suffix. */
function Wordmark() {
  return (
    <span className="font-extrabold text-[17px] tracking-tight select-none text-[#2b2b2b] dark:text-ink whitespace-nowrap">
      SuperPi
      <svg
        viewBox="0 0 3 3"
        className="inline h-[0.545em] w-[0.545em] mx-px align-baseline"
        fill="currentColor"
        aria-hidden
      >
        <rect x="0" y="0" width="1" height="1" />
        <rect x="2" y="0" width="1" height="1" />
        <rect x="1" y="1" width="1" height="1" />
        <rect x="0" y="2" width="1" height="1" />
        <rect x="2" y="2" width="1" height="1" />
      </svg>
      el
      <span className="ml-1.5 text-[13px] font-medium text-ink-faint">Clock</span>
    </span>
  );
}

export default function ClockPage() {
  const { data: session } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Light/dark toggle — same hermes-theme mechanism as the main app.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("hermes-theme", next ? "dark" : "light");
    } catch {}
  };

  // 1s tick drives the live timers.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // When the totals were fetched — lets the "today" numbers tick live between
  // refreshes while working (they freeze on break; every break toggle reloads).
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  // Slack status sync (opt-in): null = unknown, else connected or not.
  const [slackSync, setSlackSync] = useState<boolean | null>(null);
  useEffect(() => {
    api.get<{ connected: boolean }>("/api/slack-status").then((res) => {
      if (res.ok) setSlackSync(res.data.connected);
    });
    const q = new URLSearchParams(window.location.search).get("slack");
    if (q === "connected") setSlackSync(true);
    else if (q === "mismatch")
      setError("That Slack account doesn't match the one you're signed in with.");
    else if (q === "error") setError("Slack connection failed — try again.");
    if (q) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const stopSlackSync = async () => {
    await api.del("/api/slack-status");
    setSlackSync(false);
  };

  const load = useCallback(async () => {
    const res = await api.get<Me>("/api/timeclock/me");
    if (res.ok) {
      setMe(res.data);
      setFetchedAt(Date.now());
      setError("");
    } else setError(res.error);
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const onFocus = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const weekByProject = useMemo(
    () => new Map((me?.week ?? []).map((w) => [w.projectId, w.ms])),
    [me]
  );
  const todayByProject = useMemo(
    () => new Map((me?.today ?? []).map((t) => [t.projectId, t.ms])),
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

  /**
   * @param task the task to mark "doing" once the clock-in succeeds.
   * Passed EXPLICITLY (defaulting to pendingTask state) because startTask
   * calls clockIn in the same tick it sets the state — reading only the
   * state here meant the closure still saw null and the task was never
   * marked doing. The state remains for the switch-confirm flow, where the
   * confirmation tap happens on a later render.
   */
  const clockIn = async (projectId: string, force = false, task: TcTask | null = pendingTask) => {
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
      if (task && task.projectId === projectId) {
        const marked = await api.post("/api/timeclock/task", {
          projectId,
          taskId: task.id,
          status: "doing",
        });
        if (!marked.ok) setError(`Clocked in, but couldn't mark the task: ${marked.error}`);
        setPendingTask(null);
      }
      load(); // refresh weekly totals + tasks
    }
    setBusy(false);
  };

  /** Tap a task: clock into its project and mark it doing — one action.
   * From standby the switch is silent (no work being abandoned). */
  const startTask = (t: TcTask) => {
    setPendingTask(t); // kept for the switch-confirm flow
    clockIn(t.projectId, me?.active?.projectId === STANDBY_ID, t);
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

  /** Break/Resume — break time is excluded from all totals. */
  const toggleBreak = async () => {
    if (busy || !me?.active) return;
    setBusy(true);
    const res = await api.post<{ onBreak: boolean; breakAt?: string }>("/api/timeclock/break");
    if (!res.ok) setError(res.error);
    await load();
    setBusy(false);
  };

  const activeProject = me?.active
    ? me.projects.find((p) => p.id === me.active!.projectId)
    : undefined;
  const onBreak = !!me?.active?.breakAt;
  const onStandby = me?.active?.projectId === STANDBY_ID;

  // Today's totals: what the API measured at fetch time, plus the seconds
  // worked since (only while actively working — a break freezes them).
  const liveExtra = me?.active && !onBreak ? Math.max(0, now - fetchedAt) : 0;
  const todayTotal = (me?.today ?? []).reduce((acc, t) => acc + t.ms, 0) + liveExtra;
  const activeProjToday = me?.active
    ? ((me.today ?? []).find((t) => t.projectId === me.active!.projectId)?.ms ?? 0) + liveExtra
    : 0;

  // Project search: while typing, match across ALL projects (incl. "others").
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Tasks live INSIDE their project row (dropdown), not as a separate list.
  const [expandedProj, setExpandedProj] = useState<string | null>(null);
  const tasksFor = (projectId: string) => (me?.tasks ?? []).filter((t) => t.projectId === projectId);

  /** Tiny Slack mark for the sync banner. */
  function SlackGlyph() {
    return (
      <svg width="14" height="14" viewBox="0 0 122.8 122.8" aria-hidden className="shrink-0 text-ink-faint">
        <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="currentColor" />
        <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="currentColor" />
        <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="currentColor" />
        <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="currentColor" />
      </svg>
    );
  }

  /** One task row — used inside "My tasks here" and expanded project rows. */
  const taskRow = (t: TcTask) => (
    <div key={t.id} className="rounded-xl bg-parchment-dark/50 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold truncate">{t.title}</p>
          <p className="text-[11px] text-ink-faint truncate">
            {t.phase ? `${t.phase} · ` : ""}
            {t.dueDate
              ? `due ${new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })} · `
              : ""}
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
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card/60 px-2.5 py-1.5 text-[12px] text-ink-soft hover:border-ink-faint hover:text-ink disabled:opacity-50 shrink-0"
          >
            <Send size={11} />
            To review
          </button>
        ) : (
          <button
            onClick={() => startTask(t)}
            disabled={busy || t.status === "review"}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] text-white hover:bg-accent-hover disabled:opacity-40 shrink-0"
          >
            <Play size={11} />
            Start
          </button>
        )}
      </div>
      {t.status === "revision" && t.statusNote && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-soft">
          <CornerDownRight size={11} className="mt-0.5 shrink-0 text-red-500" />
          {t.statusNote}
        </p>
      )}
    </div>
  );

  const activeTasks = me?.active ? tasksFor(me.active.projectId) : [];

  const greet = (() => {
    const h = new Date(now).getHours();
    const part = h < 11 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    return `${part}, ${session?.user?.name?.split(" ")[0] ?? "Pixels"}`;
  })();

  return (
    <div className="mx-auto max-w-md px-4 py-5 min-h-screen flex flex-col">
      {/* Header: wordmark + theme toggle */}
      <div className="flex items-center mb-4">
        <Wordmark />
        <span className="flex-1" />
        <button
          onClick={toggleTheme}
          className="glass w-9 h-9 rounded-xl flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!me && !error && <p className="text-sm text-ink-faint py-10 text-center">Loading…</p>}

      {me && (
        <>
          {/* Hero — the day total IS the app. */}
          <p className="text-center text-[12px] text-ink-soft" suppressHydrationWarning>
            {greet}
          </p>
          <p
            className={`mt-3 text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] ${
              onBreak ? "text-amber-500" : "text-ink-faint"
            }`}
          >
            {onBreak ? "On break — paused" : "Today · all projects"}
          </p>
          <p
            className={`text-center font-mono text-[44px] leading-tight font-bold tracking-tight tabular-nums ${
              onBreak ? "text-ink-faint" : ""
            }`}
            suppressHydrationWarning
          >
            {fmtTimer(todayTotal)}
          </p>
          <p className="text-center text-[12px] font-semibold min-h-[1.2em]" suppressHydrationWarning>
            {me.active ? (
              onStandby ? (
                <span className="text-violet-500">
                  <Armchair size={11} className="inline mr-1 -mt-0.5" />
                  Standby · <span className="font-mono tabular-nums">{fmtTimer(activeProjToday)}</span>
                </span>
              ) : (
                <span className={onBreak ? "text-ink-faint" : "text-accent"}>
                  {activeProject?.name ?? "Deleted project — clock out"} ·{" "}
                  <span className="font-mono tabular-nums">{fmtTimer(activeProjToday)}</span>
                </span>
              )
            ) : (
              <span className="text-ink-faint">Not clocked in — pick a project below</span>
            )}
          </p>

          {/* Round action buttons */}
          <div className="flex items-center justify-center gap-3.5 my-4">
            {me.active ? (
              <>
                <button
                  onClick={toggleBreak}
                  disabled={busy}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                    onBreak
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "glass text-ink-soft hover:text-ink"
                  }`}
                  title={onBreak ? "Resume" : "Break"}
                >
                  {onBreak ? <Play size={16} /> : <Coffee size={16} />}
                </button>
                <button
                  onClick={clockOut}
                  disabled={busy}
                  className="w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-[0_10px_24px_rgba(21,102,224,0.4)]"
                  title="Clock out"
                >
                  <Square size={18} />
                </button>
                <button
                  onClick={() => !onStandby && clockIn(STANDBY_ID, true)}
                  disabled={busy || onStandby}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                    onStandby
                      ? "bg-violet-500 text-white cursor-default"
                      : "border border-violet-500/50 bg-violet-500/10 text-violet-500 hover:bg-violet-500/20"
                  } disabled:opacity-80`}
                  title={onStandby ? "You are on standby" : "Go on standby"}
                >
                  <Armchair size={15} />
                </button>
              </>
            ) : (
              <button
                onClick={() => clockIn(STANDBY_ID, true)}
                disabled={busy}
                className="flex items-center gap-2 rounded-full border border-violet-500/50 bg-violet-500/10 px-4 py-2.5 text-[13px] font-medium text-violet-500 hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
                title="Present but not on a project"
              >
                <Armchair size={14} />
                Go on standby
              </button>
            )}
          </div>
          {onStandby && (
            <p className="-mt-1 mb-3 text-center text-[11.5px] text-ink-faint">
              Clock in on any project below — standby ends by itself.
            </p>
          )}

          {/* My tasks here — same as the old active card, now its own glass card. */}
          {me.active && activeTasks.length > 0 && (
            <div className="glass-panel rounded-2xl border border-line/50 p-3.5 mb-3">
              <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-2">
                <ListChecks size={11} />
                My tasks here · {activeTasks.length}
              </p>
              <div className="space-y-1.5">{activeTasks.map(taskRow)}</div>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
              className="glass-panel w-full rounded-xl border border-line/50 pl-9 pr-9 py-2.5 text-[14px] bg-transparent placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-faint hover:text-ink"
                title="Clear"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Switch to / Clock in to — one glass card of project rows. */}
          <div className="glass-panel rounded-2xl border border-line/50 p-3.5 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-2">
              {me.active && !onStandby ? "Switch to" : "Clock in to"}
            </p>
            <div className="space-y-1">
              {(q
                ? [...mineProjects, ...otherProjects].filter((p) =>
                    p.name.toLowerCase().includes(q)
                  )
                : showOthers
                  ? [...mineProjects, ...otherProjects]
                  : mineProjects
              ).map((p) => {
                const isActive = me.active?.projectId === p.id;
                if (isActive) return null;
                const weekMs = weekByProject.get(p.id) ?? 0;
                const todayMs = todayByProject.get(p.id) ?? 0;
                const confirming = confirmSwitch === p.id;
                const tasks = tasksFor(p.id);
                const isOpen = expandedProj === p.id;
                const directIn = !me.active || onStandby;

                return (
                  <div
                    key={p.id}
                    className={
                      confirming
                        ? "glass-ice anim-pop rounded-xl border-[1.5px] border-accent p-3"
                        : "rounded-xl px-1 py-1.5"
                    }
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${p.color}22` }}
                      >
                        <FolderKanban size={13} style={{ color: p.color }} />
                      </div>
                      <div
                        className={`flex-1 min-w-0 ${tasks.length > 0 ? "cursor-pointer select-none" : ""}`}
                        onClick={() => tasks.length > 0 && setExpandedProj(isOpen ? null : p.id)}
                        title={tasks.length > 0 ? "Show my tasks in this project" : undefined}
                      >
                        <p className="font-semibold text-[13.5px] truncate flex items-center gap-1">
                          {p.name}
                          {tasks.length > 0 &&
                            (isOpen ? (
                              <ChevronDown size={12} className="text-ink-faint shrink-0" />
                            ) : (
                              <ChevronRight size={12} className="text-ink-faint shrink-0" />
                            ))}
                        </p>
                        <p className="text-[11px] text-ink-faint truncate">
                          {tasks.length > 0 ? `${tasks.length} task${tasks.length > 1 ? "s" : ""} · ` : ""}
                          {todayMs > 0 ? `${fmtDur(todayMs)} today · ` : ""}
                          {weekMs > 0 ? `${fmtDur(weekMs)} wk` : "no time this wk"}
                        </p>
                      </div>
                      {!confirming &&
                        (directIn ? (
                          <button
                            onClick={() => clockIn(p.id, onStandby)}
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-white text-[12.5px] font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
                          >
                            <Play size={12} />
                            Clock in
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmSwitch(p.id)}
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-xl border border-line bg-card/50 px-3 py-2 text-[12px] text-ink-soft hover:border-ink-faint hover:text-ink disabled:opacity-50 transition-colors shrink-0"
                          >
                            <ArrowLeftRight size={12} />
                            Switch
                          </button>
                        ))}
                    </div>

                    {/* Inline ice-glass switch confirmation (approved mock). */}
                    {confirming && (
                      <div className="mt-2.5">
                        <p className="text-[12.5px] text-ink-soft leading-relaxed mb-2.5">
                          Clock out of{" "}
                          <span className="font-semibold text-ink">
                            {activeProject?.name ?? "your current project"}
                          </span>{" "}
                          and start here? Your{" "}
                          <span className="font-mono tabular-nums font-semibold text-ink">
                            {fmtTimer(activeProjToday)}
                          </span>{" "}
                          there is saved.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => clockIn(p.id, true)}
                            disabled={busy}
                            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                          >
                            <ArrowLeftRight size={13} />
                            Switch
                          </button>
                          <button
                            onClick={() => {
                              setConfirmSwitch(null);
                              setPendingTask(null);
                            }}
                            className="flex-1 rounded-xl border border-line bg-card/50 px-3 py-2.5 text-[13px] text-ink-soft hover:border-ink-faint"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tasks live inside the row — tap the name to open. */}
                    {isOpen && tasks.length > 0 && !confirming && (
                      <div className="mt-2 space-y-1.5 pl-9">{tasks.map(taskRow)}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {q &&
              [...mineProjects, ...otherProjects].filter((p) => p.name.toLowerCase().includes(q))
                .length === 0 && (
                <p className="text-sm text-ink-faint text-center py-5">
                  No projects match &ldquo;{query.trim()}&rdquo;.
                </p>
              )}

            {!q && otherProjects.length > 0 && (
              <button
                onClick={() => setShowOthers(!showOthers)}
                className="w-full text-center text-[12px] text-ink-faint hover:text-ink py-2 transition-colors"
              >
                {showOthers ? "Hide other projects" : `Show other projects · ${otherProjects.length}`}
              </button>
            )}

            {mineProjects.length === 0 && otherProjects.length === 0 && (
              <p className="text-sm text-ink-faint text-center py-8">
                No projects yet — create one in the SuperPixel Assistant first.
              </p>
            )}
            {!q && mineProjects.length === 0 && otherProjects.length > 0 && !showOthers && (
              <p className="text-sm text-ink-faint text-center py-5">
                No projects assigned to you yet — ask your PM for a task, or show other projects
                above.
              </p>
            )}
          </div>
        </>
      )}

      {/* Slack status sync — one-time opt-in, then automatic. */}
      {slackSync !== null && (
        <div className="glass-panel mt-4 flex items-center gap-2 rounded-xl border border-line/50 px-3.5 py-2.5 text-[12.5px]">
          <SlackGlyph />
          {slackSync ? (
            <>
              <span className="text-ink-soft">
                Slack status syncs with your clock (🎬 working · ☕ break).
              </span>
              <span className="flex-1" />
              <button onClick={stopSlackSync} className="text-ink-faint hover:text-red-500 shrink-0">
                Stop
              </button>
            </>
          ) : (
            <>
              <span className="text-ink-soft">Set my Slack status automatically when I clock in.</span>
              <span className="flex-1" />
              <a
                href="/api/slack-status/connect"
                className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white hover:bg-accent-hover shrink-0"
              >
                Connect
              </a>
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between text-[12px] text-ink-faint">
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
