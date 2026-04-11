"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity, Zap, CheckCircle2, XCircle, Clock,
  Network, Kanban, FolderOpen, ArrowRight,
  TrendingUp, Cpu, Brain, DollarSign, GitBranch,
  AlertTriangle, Play, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import { listHiveSessions, listBucketTasks } from "@/lib/engine-client";
import type { HiveSession, BucketTask } from "@/lib/engine-client";

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, accent, trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string; trend?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-elevated rounded-2xl p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{label}</span>
        <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", accent)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold text-slate-100 tracking-tight">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {trend != null && (
        <div className={cn("flex items-center gap-1 text-xs font-semibold", trend >= 0 ? "text-emerald-400" : "text-red-400")}>
          <TrendingUp className="w-3 h-3" />
          {trend >= 0 ? "+" : ""}{trend}% this session
        </div>
      )}
    </motion.div>
  );
}

// ── Quick Action Card ─────────────────────────────────────────────────────────
function QuickAction({
  label, desc, icon: Icon, href, color,
}: {
  label: string; desc: string; icon: React.ElementType; href: string; color: string;
}) {
  const router = useRouter();
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => router.push(href)}
      className="card-elevated rounded-2xl p-4 flex items-center gap-4 hover:border-slate-600/50 transition-all text-left group"
    >
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-200">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{desc}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all shrink-0" />
    </motion.button>
  );
}

// ── Recent Hive Session ───────────────────────────────────────────────────────
function SessionRow({ session }: { session: HiveSession }) {
  const statusColors: Record<string, string> = {
    completed: "text-emerald-400 bg-emerald-950/50 border-emerald-800/30",
    failed:    "text-red-400    bg-red-950/50    border-red-800/30",
    running:   "text-indigo-400 bg-indigo-950/50 border-indigo-800/30",
    killed:    "text-slate-400  bg-slate-800/50  border-slate-700/30",
  };
  const cls = statusColors[session.status] ?? statusColors.killed;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-300 truncate">{session.prompt_preview}</p>
        <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
          #{session.id.slice(0, 8)} · {session.agent_count} agents · {new Date(session.created_at).toLocaleString()}
        </p>
      </div>
      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize shrink-0", cls)}>
        {session.status}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { hiveAgents, isRunning, bucketTasks, sessionStatus, charCount, provider, budgetLimit } = useHiveStore();
  const [sessions,    setSessions]    = useState<HiveSession[]>([]);
  const [allTasks,    setAllTasks]    = useState<BucketTask[]>([]);

  useEffect(() => {
    listHiveSessions().then(setSessions).catch(() => {});
    listBucketTasks().then(setAllTasks).catch(() => {});
  }, []);

  const tokenEst  = Math.round(charCount / 4);
  const COST_MAP  = { google: 0.00025, openai: 0.005, anthropic: 0.003 };
  const costEst   = (tokenEst / 1000) * (COST_MAP[provider as keyof typeof COST_MAP] ?? 0.003);

  const liveTasks      = bucketTasks.length > 0 ? bucketTasks : allTasks;
  const totalTasks     = sessions.reduce((s, h) => s + h.agent_count, 0);
  const completedSess  = sessions.filter((s) => s.status === "completed").length;
  const successRate    = sessions.length > 0
    ? Math.round((completedSess / sessions.length) * 100)
    : 0;
  const pendingBucket  = liveTasks.filter((t) => t.status === "PENDING").length;
  const doneBucket     = liveTasks.filter((t) => t.status === "COMPLETED").length;

  const quickActions = [
    { label: "Add Tasks to Backlog",      desc: "Manage your Kanban task queue",          icon: Plus,    href: "/backlog",        color: "bg-indigo-600/20 text-indigo-400" },
    { label: "View Agent Orchestration",  desc: "Live network graph of active agents",    icon: Network, href: "/orchestration",  color: "bg-violet-600/20 text-violet-400" },
    { label: "Browse Workspace Files",    desc: "IDE-style file explorer for outputs",    icon: FolderOpen, href: "/workspace",  color: "bg-slate-700/60  text-slate-400"  },
    { label: "Configure LLM Providers",  desc: "Manage API keys and cost guardrails",    icon: Zap,     href: "/settings",       color: "bg-amber-600/20  text-amber-400"  },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-white/5 flex items-center justify-between px-6 py-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Hive Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">Dashboard · Real-time health of your agent swarm</p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300 px-3 py-1.5 rounded-full bg-indigo-950/50 border border-indigo-800/30"
            >
              <Cpu className="w-3 h-3" />
              Hive Running
            </motion.div>
          )}
          <button
            onClick={() => router.push("/backlog")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors shadow-lg shadow-indigo-900/30"
          >
            <Play className="w-3.5 h-3.5" /> Start Task
          </button>
        </div>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {/* ── Stats Grid ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Hive Health</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Active Projects"
              value={sessions.filter(s => s.status === "running").length || (isRunning ? 1 : 0)}
              sub={`${sessions.length} total sessions`}
              icon={GitBranch}
              accent="bg-indigo-600/20 text-indigo-400"
            />
            <StatCard
              label="Total Agents Spawned"
              value={totalTasks}
              sub={`${hiveAgents.length} in current session`}
              icon={Cpu}
              accent="bg-violet-600/20 text-violet-400"
            />
            <StatCard
              label="Success Rate"
              value={`${successRate}%`}
              sub={`${completedSess}/${sessions.length} sessions completed`}
              icon={CheckCircle2}
              accent="bg-emerald-600/20 text-emerald-400"
            />
            <StatCard
              label="Estimated Cost"
              value={`$${costEst.toFixed(3)}`}
              sub={`${tokenEst.toLocaleString()} tokens · limit $${budgetLimit}`}
              icon={DollarSign}
              accent={costEst >= budgetLimit ? "bg-red-600/20 text-red-400" : "bg-slate-700 text-slate-400"}
            />
          </div>
        </section>

        {/* ── Bucket Summary ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Task Bucket Status</h2>
          <div className="card-elevated rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Kanban className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold text-slate-300">Backlog Overview</span>
              </div>
              <button
                onClick={() => router.push("/backlog")}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                Open Kanban <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {liveTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-600">
                <Activity className="w-8 h-8" />
                <p className="text-xs">No tasks in bucket yet. Go to Backlog to add tasks.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Backlog",     count: liveTasks.filter(t => t.status === "PENDING").length,     color: "text-slate-400", bg: "bg-slate-800/60" },
                  { label: "In Progress", count: liveTasks.filter(t => t.status === "IN_PROGRESS").length, color: "text-indigo-400", bg: "bg-indigo-950/40" },
                  { label: "Completed",   count: liveTasks.filter(t => t.status === "COMPLETED").length,   color: "text-emerald-400",bg: "bg-emerald-950/40" },
                  { label: "Failed",      count: liveTasks.filter(t => t.status === "FAILED").length,      color: "text-red-400",    bg: "bg-red-950/40" },
                  { label: "Cancelled",   count: liveTasks.filter(t => t.status === "CANCELLED").length,   color: "text-slate-500",  bg: "bg-slate-800/40" },
                ].map(({ label, count, color, bg }) => (
                  <div key={label} className={cn("rounded-xl p-3 text-center", bg)}>
                    <p className={cn("text-2xl font-bold", color)}>{count}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Quick Actions ───────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {quickActions.map((a) => (
              <QuickAction key={a.href} {...a} />
            ))}
          </div>
        </section>

        {/* ── Recent Sessions ─────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Recent Hive Sessions</h2>
            <button
              onClick={() => router.push("/orchestration")}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              View Graph <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="card-elevated rounded-2xl px-5">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
                <Clock className="w-8 h-8" />
                <p className="text-xs">No hive sessions yet. Start your first session from the Backlog.</p>
              </div>
            ) : (
              sessions.slice(0, 8).map((s) => <SessionRow key={s.id} session={s} />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
