"use client";

/**
 * AgentHive — Shared Navigation Rail + Global Status Bar Layout
 * All routes in the (hive) group share this shell.
 * WebSocket and Bucket SSE bridges are initialized here once,
 * keeping state alive across all route navigations.
 */

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Kanban, Network, FolderOpen, Settings,
  Zap, Cpu, DollarSign, Brain, Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import { useHiveSocket } from "@/lib/use-hive-socket";
import type { HiveEvent } from "@/lib/use-hive-socket";
import type { AgentStatus } from "@/lib/engine-client";
import {
  listBucketTasks,
  streamBucketProgress,
  type BucketProgressWithTasks,
} from "@/lib/engine-client";

// ─── Cost per 1k tokens ───────────────────────────────────────────────────────
const COST_PER_1K = { google: 0.00025, openai: 0.005, anthropic: 0.003 };

// ─── Nav items ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: "/dashboard",     label: "Overview",      icon: LayoutDashboard, tooltip: "Hive Health Dashboard" },
  { href: "/backlog",       label: "Backlog",       icon: Kanban,          tooltip: "Kanban Task Board" },
  { href: "/orchestration", label: "Orchestration", icon: Network,         tooltip: "Live Agent Graph" },
  { href: "/workspace",     label: "Workspace",     icon: FolderOpen,      tooltip: "File Explorer & IDE" },
  { href: "/settings",      label: "Settings",      icon: Settings,        tooltip: "LLM Providers & Keys" },
] as const;

// ─── Global Status Bar ────────────────────────────────────────────────────────
function GlobalStatusBar() {
  const {
    hiveId, isRunning, sessionStatus,
    hiveAgents, charCount, provider, budgetLimit,
    wsEvents, bucketTasks,
  } = useHiveStore();

  const tokenEstimate   = Math.round(charCount / 4);
  const costEstimate    = (tokenEstimate / 1000) * (COST_PER_1K[provider as keyof typeof COST_PER_1K] ?? 0.003);
  const overBudget      = costEstimate >= budgetLimit;
  const activeAgents    = hiveAgents.filter((a) => a.status === "working" || a.status === "thinking").length;
  const doneAgents      = hiveAgents.filter((a) => a.status === "completed").length;
  const pendingTasks    = bucketTasks.filter((t) => t.status === "PENDING").length;
  const inProgressTasks = bucketTasks.filter((t) => t.status === "IN_PROGRESS").length;

  return (
    <div className="status-bar h-8 flex items-center gap-4 px-4 text-[11px] shrink-0 z-50">
      {/* Brand + status dot */}
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full",
          isRunning ? "bg-indigo-400 animate-pulse" : "bg-slate-600"
        )} />
        <span className="font-semibold text-slate-400">
          {isRunning ? "Hive Active" : sessionStatus === "completed" ? "Completed" : "System Ready"}
        </span>
        {hiveId && (
          <span className="font-mono text-slate-600 text-[10px]">#{hiveId.slice(0, 8)}</span>
        )}
      </div>

      <div className="w-px h-4 bg-slate-800/80" />

      {/* Agent stats */}
      {hiveAgents.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Cpu className="w-3 h-3" />
            <span>
              <span className="text-slate-300 font-semibold">{activeAgents}</span>
              {" active / "}
              <span className="text-emerald-500 font-semibold">{doneAgents}</span>
              {" done"}
            </span>
          </div>
          <div className="w-px h-4 bg-slate-800/80" />
        </>
      )}

      {/* Token / cost */}
      {charCount > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Brain className="w-3 h-3" />
            <span className="font-mono text-slate-400">{tokenEstimate.toLocaleString()} tok</span>
          </div>
          <div className="flex items-center gap-1 text-slate-500">
            <DollarSign className="w-3 h-3" />
            <span className={cn("font-mono font-semibold", overBudget ? "text-red-400" : "text-emerald-400")}>
              ~{costEstimate.toFixed(3)}
            </span>
          </div>
          <div className="w-px h-4 bg-slate-800/80" />
        </>
      )}

      {/* Bucket task counts */}
      {(pendingTasks > 0 || inProgressTasks > 0) && (
        <div className="flex items-center gap-1.5 text-slate-500">
          <Kanban className="w-3 h-3" />
          {inProgressTasks > 0 && (
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="text-indigo-400 font-semibold"
            >
              {inProgressTasks} running
            </motion.span>
          )}
          {pendingTasks > 0 && (
            <span className="text-slate-500">{pendingTasks} queued</span>
          )}
        </div>
      )}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        {wsEvents.length > 0 && (
          <span className="text-slate-600">{wsEvents.length} events</span>
        )}
        <span className="text-slate-700 font-mono">AgentHive</span>
        <span className="text-slate-700 font-mono text-[9px]">v0.5</span>
      </div>
    </div>
  );
}

// ─── WebSocket Bridge ─────────────────────────────────────────────────────────
// Initialized once in the layout — updates the global Zustand store.
// All pages read from the store, so WebSocket activity continues seamlessly
// when navigating between routes.
function HiveSocketBridge() {
  const {
    hiveId, pushWsEvents, updateAgentStatus, upsertAgent,
    addCharCount, updateThought, updateToolCall, pushShellLines,
    addRecentChange, clearSession, setPendingReview,
  } = useHiveStore();

  const evBuf = useRef<HiveEvent[]>([]);
  const shBuf = useRef<string[]>([]);
  const thBuf = useRef<Record<string, string>>({});
  const tcBuf = useRef<Record<string, string>>({});

  // 150ms rAF batch flush
  useEffect(() => {
    let rafId: number;
    let last = performance.now();

    const tick = (t: number) => {
      if (t - last > 150) {
        if (evBuf.current.length) {
          const buf = evBuf.current.splice(0);
          pushWsEvents(buf);
          addCharCount(buf.reduce((s, e) => {
            try {
              const str = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
              return s + (str?.length || 0);
            } catch { return s; }
          }, 0));

          for (const ev of buf) {
            if (ev.event_type === "SPAWN") {
              const d = typeof ev.data === "object" ? ev.data as Record<string, unknown> : {};
              upsertAgent({
                id: ev.agent_id,
                role: String(d.role || "unknown"),
                session_id: ev.hive_id || "",
                parent_id: ev.parent_id || null,
                status: "thinking",
                specialized_task: String(d.task_preview || ""),
                local_context: {},
                children: [],
                created_at: new Date().toISOString(),
                completed_at: null,
              });
            } else if (ev.event_type === "STATUS") {
              const d = typeof ev.data === "object" ? ev.data as Record<string, unknown> : {};
              if (d.status) updateAgentStatus(ev.agent_id, d.status as AgentStatus);
              if (d.status === "review_requested") {
                setPendingReview({ summary: String(d.summary ?? "Ready for review.") });
              }
            }
          }
        }

        if (shBuf.current.length) pushShellLines(shBuf.current.splice(0));

        if (Object.keys(thBuf.current).length) {
          const snap = { ...thBuf.current }; thBuf.current = {};
          Object.entries(snap).forEach(([id, t]) => updateThought(id, t));
        }

        if (Object.keys(tcBuf.current).length) {
          const snap = { ...tcBuf.current }; tcBuf.current = {};
          Object.entries(snap).forEach(([id, tc]) => updateToolCall(id, tc));
        }

        last = t;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHiveSocket({
    hiveId,
    onEvent:       (ev) => { evBuf.current.push(ev); },
    onThought:     (ev) => {
      const d = typeof ev.data === "object" ? ev.data as Record<string, unknown> : {};
      if (d.line) thBuf.current[ev.agent_id] = String(d.line);
    },
    onToolCall:    (ev) => {
      const d = typeof ev.data === "object" ? ev.data as Record<string, unknown> : {};
      tcBuf.current[ev.agent_id] = `${d.tool}${d.path ? `: ${d.path}` : d.command ? `: ${d.command}` : ""}`;
    },
    onShellOutput: (ev) => {
      const d = typeof ev.data === "object" ? ev.data as Record<string, unknown> : {};
      if (d.line) shBuf.current.push(String(d.line));
    },
    onFileChange:  (ev) => {
      const d = typeof ev.data === "object" ? ev.data as Record<string, unknown> : {};
      if (d.path) addRecentChange({ path: String(d.path), op: (d.op as "created" | "modified" | "deleted") ?? "modified" });
    },
    onClear: clearSession,
  });

  return null;
}

// ─── Bucket SSE Bridge ────────────────────────────────────────────────────────
function BucketBridge() {
  const { setBucketTasks, setBucketProgress, setIsRunning } = useHiveStore();

  useEffect(() => {
    // Initial fetch
    listBucketTasks().then(setBucketTasks).catch(() => {});

    let cleanup: (() => void) | null = null;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function connect() {
      if (!active) return;
      cleanup = streamBucketProgress(
        (data: BucketProgressWithTasks) => {
          retryDelay = 1000; // reset on success
          setBucketProgress(data);
          setBucketTasks(data.tasks ?? []);
          setIsRunning(data.factory_running ?? false);
        },
        () => {
          // SSE error → schedule reconnect
          if (active) {
            retryTimer = setTimeout(() => {
              retryDelay = Math.min(retryDelay * 2, 15000);
              connect();
            }, retryDelay);
          }
        }
      );
    }

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      cleanup?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}


// ─── Main Layout ──────────────────────────────────────────────────────────────
export default function HiveLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [cmdOpen, setCmdOpen] = useState(false);
  const { isRunning } = useHiveStore();

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="h-screen flex flex-col dashboard-bg text-slate-200 overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Navigation Rail ──────────────────────────────────────────────── */}
        <nav className="nav-rail w-14 flex flex-col items-center py-4 gap-1 shrink-0 z-40">
          {/* Logo */}
          <div className="mb-5 flex items-center justify-center">
            <div className="relative">
              <div
                className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/50 cursor-pointer"
                onClick={() => router.push("/dashboard")}
              >
                <Zap className="w-4 h-4 text-white" />
              </div>
              {isRunning && (
                <motion.div
                  className="absolute inset-0 rounded-xl border border-indigo-400/60"
                  animate={{ opacity: [1, 0, 1], scale: [1, 1.25, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
              )}
            </div>
          </div>

          {/* Nav items */}
          {NAV_ITEMS.map(({ href, label, icon: Icon, tooltip }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <button
                key={href}
                id={`nav-${href.slice(1)}`}
                onClick={() => router.push(href)}
                title={tooltip}
                className={cn(
                  "relative group w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200",
                  active
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "text-slate-600 hover:text-slate-300 hover:bg-slate-800/60"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="nav-active-pill"
                    className="absolute left-0 w-0.5 h-5 bg-indigo-500 rounded-r-full -ml-2"
                  />
                )}
                <Icon className="w-[18px] h-[18px]" />
                {/* Tooltip */}
                <span className="absolute left-full ml-3 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/50 text-xs font-medium text-slate-200 whitespace-nowrap
                  opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl">
                  {tooltip}
                </span>
              </button>
            );
          })}

          {/* Bottom: Cmd+K */}
          <div className="mt-auto">
            <button
              onClick={() => setCmdOpen(true)}
              title="Command Palette (Ctrl+K)"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800/60 transition-all group relative"
            >
              <Command className="w-[18px] h-[18px]" />
              <span className="absolute left-full ml-3 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/50 text-xs font-medium text-slate-200 whitespace-nowrap
                opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl">
                Command Palette (Ctrl+K)
              </span>
            </button>
          </div>
        </nav>

        {/* ── Page Content ─────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>

      {/* ── Global Status Bar ─────────────────────────────────────────────── */}
      <GlobalStatusBar />

      {/* ── Invisible SSE / WS Bridges ───────────────────────────────────── */}
      <HiveSocketBridge />
      <BucketBridge />
    </div>
  );
}
