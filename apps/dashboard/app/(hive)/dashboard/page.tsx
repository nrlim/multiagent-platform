"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity, Zap, CheckCircle2, Clock,
  Network, FolderOpen, ArrowRight,
  TrendingUp, Cpu, Brain, DollarSign, GitBranch,
  Play, Plus, Send, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import { listHiveSessions, listBucketTasks, createBucketTask } from "@/lib/engine-client";
import type { HiveSession, BucketTask } from "@/lib/engine-client";

// ── Metric Card ────────────────────────────────────────────────────────────────
function MetricCard({
  label, value, sub, icon: Icon, accent, trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string; trend?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-elevated rounded-lg p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">{label}</span>
        <div className={cn("w-7 h-7 rounded-md flex items-center justify-center", accent)}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {trend != null && (
        <div className={cn("flex items-center gap-1 text-xs font-semibold", trend >= 0 ? "text-emerald-600" : "text-red-600")}>
          <TrendingUp className="w-3 h-3" />
          {trend >= 0 ? "+" : ""}{trend}% this session
        </div>
      )}
    </motion.div>
  );
}

// ── Recent Activity Row ────────────────────────────────────────────────────────
function ActivityRow({ session }: { session: HiveSession }) {
  const statusDot: Record<string, string> = {
    completed: "bg-emerald-500",
    failed:    "bg-red-500",
    running:   "bg-indigo-500 animate-pulse",
    killed:    "bg-slate-400",
  };
  const statusLabel: Record<string, string> = {
    completed: "Completed", failed: "Failed", running: "Running", killed: "Killed",
  };
  const dotCls = statusDot[session.status] ?? "bg-slate-400";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-200 last:border-0 group">
      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotCls)} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-800 truncate">{session.prompt_preview}</p>
        <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
          #{session.id.slice(0, 8)} · {session.agent_count} agents · {new Date(session.created_at).toLocaleString()}
        </p>
      </div>
      <span className={cn(
        "text-[10px] font-semibold px-2 py-0.5 rounded border capitalize shrink-0",
        session.status === "completed" ? "bg-emerald-50 border-emerald-200 text-emerald-600" :
        session.status === "failed"    ? "bg-red-50    border-red-200    text-red-600" :
        session.status === "running"   ? "bg-indigo-50 border-indigo-200 text-indigo-600" :
                                         "bg-slate-100 border-slate-200  text-slate-500"
      )}>
        {statusLabel[session.status] ?? session.status}
      </span>
    </div>
  );
}

// ── Quick Action ───────────────────────────────────────────────────────────────
function QuickAction({ label, desc, icon: Icon, href, iconCls }: {
  label: string; desc: string; icon: React.ElementType; href: string; iconCls: string;
}) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="card-elevated rounded-xl p-4 flex flex-col items-start gap-4 hover:border-slate-300 transition-all text-left group h-full"
    >
      <div className="w-full flex items-center justify-between">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", iconCls)}>
          <Icon className="w-5 h-5" />
        </div>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-transform shrink-0" />
      </div>
      <div className="w-full mt-auto">
        <p className="text-xs font-bold text-slate-900 leading-tight mb-1">{label}</p>
        <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">{desc}</p>
      </div>
    </button>
  );
}

// ── Quick Start Bar ────────────────────────────────────────────────────────────
function QuickStartBar() {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const handleInject = async () => {
    if (!goal.trim() || loading) return;
    setLoading(true);
    try {
      await createBucketTask(goal.trim(), "", "HIGH");
      setDone(true);
      setGoal("");
      setTimeout(() => { setDone(false); router.push("/orchestration"); }, 1000);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-elevated rounded-lg p-1 flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2.5 px-3">
        <Zap className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleInject()}
          placeholder="Inject a new goal into the swarm… e.g. Build a REST API for user auth"
          className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none py-2.5"
        />
      </div>
      <button
        onClick={handleInject}
        disabled={!goal.trim() || loading}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-md text-xs font-semibold transition-all shrink-0",
          done
            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
            : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        )}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
        {done ? "Injected" : "Inject Goal"}
      </button>
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
  const completedSess  = sessions.filter((s) => s.status === "completed").length;
  const successRate    = sessions.length > 0 ? Math.round((completedSess / sessions.length) * 100) : 0;
  const totalAgents    = sessions.reduce((s, h) => s + h.agent_count, 0);

  const QUICK_ACTIONS = [
    { label: "Add Tasks to Backlog",     desc: "Manage your Kanban task queue",       icon: Plus,       href: "/backlog",       iconCls: "bg-slate-100 text-slate-500" },
    { label: "View Agent Orchestration", desc: "Live network graph of active agents", icon: Network,    href: "/orchestration", iconCls: "bg-indigo-50 text-indigo-600" },
    { label: "Browse Workspace Files",   desc: "IDE-style file explorer for outputs", icon: FolderOpen, href: "/workspace",     iconCls: "bg-slate-100 text-slate-500" },
    { label: "Configure LLM Providers",  desc: "Manage API keys and cost guardrails", icon: Zap,        href: "/settings",      iconCls: "bg-amber-50 text-amber-600" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto relative">
      {/* ── Professional SaaS Header ────────────────────────────────────────── */}
      <header className="glass-panel sticky top-0 z-30 px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Command Center</h1>
          <span className="hidden sm:block text-slate-300">|</span>
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span>AgentHive Platform</span>
            <span className="text-slate-400">/</span>
            <span className="text-indigo-600">Overview</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isRunning && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 px-2 py-1 rounded-md bg-white border border-indigo-100 shadow-sm uppercase tracking-wide"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              Active
            </motion.div>
          )}
          <button
            onClick={() => router.push("/orchestration")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 shadow-sm shadow-indigo-600/20 text-white text-xs font-semibold transition-all"
          >
            <Play className="w-3 h-3" /> Launch
          </button>
          <div className="hidden sm:block w-px h-5 bg-slate-200" />
          <div className="hidden sm:flex w-7 h-7 rounded-full bg-slate-100 border border-slate-200 items-center justify-center text-slate-600 font-bold text-[10px] shrink-0 cursor-pointer hover:bg-slate-200 transition-colors">
            AH
          </div>
        </div>
      </header>

      <div className="flex-1 p-6 space-y-6 w-full">
        
        {/* ── ROW 1: Key Metrics ─────────────────────────────────────────── */}
        <section>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              label="Active Projects"
              value={sessions.filter(s => s.status === "running").length || (isRunning ? 1 : 0)}
              sub={`${sessions.length} total sessions`}
              icon={GitBranch}
              accent="bg-indigo-50 text-indigo-600"
            />
            <MetricCard
              label="Agents Spawned"
              value={totalAgents}
              sub={`${hiveAgents.length} in current session`}
              icon={Cpu}
              accent="bg-slate-100 text-slate-600"
            />
            <MetricCard
              label="Task Completion"
              value={`${successRate}%`}
              sub={`${completedSess}/${sessions.length} sessions`}
              icon={CheckCircle2}
              accent="bg-emerald-50 text-emerald-600"
            />
            <MetricCard
              label="Token Usage"
              value={tokenEst > 0 ? `${tokenEst.toLocaleString()}` : "—"}
              sub={costEst > 0 ? `~$${costEst.toFixed(3)} · limit $${budgetLimit}` : "No active session"}
              icon={Brain}
              accent={costEst >= budgetLimit && costEst > 0 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"}
            />
          </div>
        </section>

        {/* ── ROW 2: Primary Actions + Task Bucket ───────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          
          {/* Quick Start Hero (Left) */}
          <section className="xl:col-span-8 relative rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-white pointer-events-none" />
            <div className="relative p-6 lg:p-8">
              <h2 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
                <Zap className="w-5 h-5 text-indigo-500" />
                Quick Dispatch
              </h2>
              <p className="text-sm text-slate-500 mb-6">Inject a high-level goal directly into the swarm for immediate execution.</p>
              <QuickStartBar />
            </div>
          </section>

          {/* Right Column: Actions & Tasks */}
          <div className="xl:col-span-4 flex flex-col gap-6">
            <section className="flex flex-col">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-3 flex-1">
                {QUICK_ACTIONS.map((a) => (
                  <QuickAction key={a.href} {...a} />
                ))}
              </div>
            </section>

            {/* Task Bucket Summary (Moved here) */}
            {liveTasks.length > 0 && (
              <section className="flex flex-col flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900">Task Bucket</h3>
                  <button
                    onClick={() => router.push("/backlog")}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors"
                  >
                    Kanban <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="card-elevated rounded-xl p-5 flex-1 flex flex-col justify-center">
                  <div className="space-y-3.5">
                    {[
                      { label: "In Progress", count: liveTasks.filter(t => t.status === "IN_PROGRESS").length, cls: "text-indigo-600", dot: "bg-indigo-500" },
                      { label: "Pending",     count: liveTasks.filter(t => t.status === "PENDING").length,     cls: "text-slate-700",  dot: "bg-slate-400" },
                      { label: "Completed",   count: liveTasks.filter(t => t.status === "COMPLETED").length,   cls: "text-emerald-600",dot: "bg-emerald-500" },
                      { label: "Failed",      count: liveTasks.filter(t => t.status === "FAILED").length,      cls: "text-red-600",    dot: "bg-red-500" },
                    ].map(({ label, count, cls, dot }) => (
                      <div key={label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("w-2 h-2 rounded-full", dot)} />
                          <span className="text-sm text-slate-600 font-medium">{label}</span>
                        </div>
                        <span className={cn("text-base font-bold", cls)}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>

        </div>

        {/* ── ROW 3: Full-width Recent Activity ──────────────────────────── */}
        <section className="w-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">Recent Activity</h3>
            <button
              onClick={() => router.push("/history")}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors"
            >
              View full history <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="card-elevated rounded-xl px-5 py-2">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
                <Clock className="w-8 h-8 opacity-50" />
                <p className="text-sm font-medium">No sessions yet. Start your first session.</p>
              </div>
            ) : (
              sessions.slice(0, 5).map((s) => <ActivityRow key={s.id} session={s} />)
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
