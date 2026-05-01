"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Network, Play, Pause, X, ChevronRight,
  MessageSquare, Cpu, CheckCircle2, XCircle, Brain,
  Loader2, StopCircle, Zap, AlertTriangle,
  Users, Plus, Inbox, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import { AgentGraph } from "@/components/agent-graph";
import { CollaborationFeed } from "@/components/collaboration-feed";
import { HiveControl } from "@/components/hive-control";
import {
  executeHive, killHiveSession, streamHiveLogs,
  createBucketTask, analyzeRequirement, type BucketPriority,
} from "@/lib/engine-client";

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_DOTS: Record<string, string> = {
  idle:      "bg-slate-300",
  thinking:  "bg-indigo-400 animate-pulse",
  working:   "bg-emerald-400 animate-pulse",
  fixing:    "bg-amber-400 animate-pulse",
  completed: "bg-emerald-400",
  error:     "bg-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  idle:      "Idle",
  thinking:  "Thinking",
  working:   "Working",
  fixing:    "Fixing",
  completed: "Done",
  error:     "Error",
};

// ─── "New Feature" Quick-Inject Widget ────────────────────────────────────────
function NewFeatureInjector() {
  const {
    bucketTasks, triggerManagerPulse, isRunning,
  } = useHiveStore();

  const [open,     setOpen]     = useState(false);
  const [title,    setTitle]    = useState("");
  const [priority, setPriority] = useState<BucketPriority>("HIGH");
  const [loading,  setLoading]  = useState(false);
  const [flash,    setFlash]    = useState(false);

  const pendingCount = bucketTasks.filter(t => t.status === "PENDING").length;

  const handleInject = useCallback(async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await createBucketTask(title.trim(), "", priority);
      triggerManagerPulse();
      // Flash success
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      setTitle("");
      setOpen(false);
    } catch (e) {
      console.error("Inject task failed:", e);
    } finally {
      setLoading(false);
    }
  }, [title, priority, triggerManagerPulse]);

  return (
    <div className="px-3 pb-3 shrink-0">
      <AnimatePresence>
        {flash && (
          <motion.div
            key="flash"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl
              bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5" /> Task injected into Bucket — Manager notified
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold",
          "border transition-all duration-200",
          open
            ? "bg-indigo-50 border-indigo-200 text-indigo-700"
            : "bg-slate-50 border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-indigo-700"
        )}
      >
        <div className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" />
          New Feature
          {pendingCount > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
              {pendingCount} pending
            </span>
          )}
        </div>
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
      </button>

      {/* Inject form */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 p-3 rounded-xl bg-white border border-slate-200">
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleInject()}
                placeholder="e.g. Add OAuth2 login endpoint"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200
                  text-xs text-slate-900 placeholder-slate-600
                  focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/40
                  transition-colors"
                autoFocus
              />
              {/* Priority pills */}
              <div className="flex gap-1.5">
                {(["HIGH", "MEDIUM", "LOW"] as BucketPriority[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 py-1 rounded-lg text-[10px] font-bold border transition-all",
                      priority === p
                        ? p === "HIGH"
                          ? "bg-rose-50 border-rose-200 text-rose-700"
                          : p === "MEDIUM"
                            ? "bg-amber-50 border-amber-200 text-amber-700"
                            : "bg-slate-100 border-slate-300 text-slate-700"
                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={handleInject}
                disabled={!title.trim() || loading}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl
                  bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold
                  hover:opacity-90 transition-opacity shadow-lg shadow-indigo-900/30
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {loading ? "Injecting…" : isRunning ? "Inject into Running Hive" : "Add to Bucket"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Left Panel: Session Launcher ─────────────────────────────────────────────
function SessionPanel({
  isRunning, isAnalyzing, onExecute, onAnalyze,
}: {
  isRunning: boolean;
  isAnalyzing: boolean;
  onExecute: (
    prompt: string,
    prov: string,
    model: string,
    opts?: { budget_limit?: number; run_qa?: boolean; require_review?: boolean }
  ) => Promise<void>;
  onAnalyze: (requirement: string, provider: string, model: string) => Promise<void>;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-200 shrink-0">
        <div className="w-6 h-6 rounded-lg bg-indigo-600/25 border border-indigo-200 flex items-center justify-center">
          <Zap className="w-3 h-3 text-indigo-600" />
        </div>
        <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">
          New Session
        </span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <HiveControl
          onExecute={onExecute}
          onAnalyze={onAnalyze}
          isRunning={isRunning}
          isAnalyzing={isAnalyzing}
        />
      </div>
    </div>
  );
}

// ─── Left Panel: Agent Roster ─────────────────────────────────────────────────
function RosterPanel({
  focusedAgentId,
  onFocusAgent,
}: {
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
}) {
  const { hiveAgents, thoughts, toolCalls, isRunning } = useHiveStore();

  const active    = hiveAgents.filter(a => a.status === "working" || a.status === "thinking").length;
  const done      = hiveAgents.filter(a => a.status === "completed").length;
  const failed    = hiveAgents.filter(a => a.status === "error").length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
            <Users className="w-3 h-3 text-slate-600" />
          </div>
          <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Agent Roster</span>
          {hiveAgents.length > 0 && (
            <span className="text-[10px] font-mono text-slate-600 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200">
              {hiveAgents.length}
            </span>
          )}
        </div>
      </div>

      {hiveAgents.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-indigo-600 font-semibold">{active}</span>
            <span className="text-slate-600">active</span>
          </div>
          <div className="w-px h-3 bg-slate-100" />
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-emerald-600 font-semibold">{done}</span>
            <span className="text-slate-600">done</span>
          </div>
          {failed > 0 && (
            <>
              <div className="w-px h-3 bg-slate-100" />
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-red-600 font-semibold">{failed}</span>
                <span className="text-slate-600">error</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* New Feature injector — always visible */}
      <div className="pt-3 border-b border-slate-200 shrink-0">
        <NewFeatureInjector />
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {hiveAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
            <Cpu className="w-6 h-6" />
            <p className="text-xs text-center">
              {isRunning ? "Spawning agents…" : "No agents yet"}
            </p>
          </div>
        ) : (
          hiveAgents.map((agent) => {
            const isFocused  = focusedAgentId === agent.id;
            const thought    = thoughts[agent.id];
            const tool       = toolCalls[agent.id];

            return (
              <motion.button
                key={agent.id}
                layout
                onClick={() => onFocusAgent(isFocused ? null : agent.id)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-all duration-150",
                  isFocused
                    ? "bg-indigo-50/50 border-indigo-200 shadow-sm shadow-indigo-100"
                    : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", STATUS_DOTS[agent.status] ?? "bg-slate-600")} />
                  <span className={cn(
                    "text-[11px] font-semibold capitalize truncate",
                    isFocused ? "text-indigo-700" : "text-slate-700"
                  )}>
                    {agent.role.replace(/_/g, " ")}
                  </span>
                  <span className={cn(
                    "ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border",
                    agent.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    agent.status === "working"   ? "bg-amber-50 text-amber-700 border-amber-200" :
                    agent.status === "thinking"  ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                    agent.status === "error"     ? "bg-red-50 text-red-700 border-red-200" :
                                                   "bg-slate-50 text-slate-600 border-slate-200"
                  )}>
                    {STATUS_LABELS[agent.status] ?? agent.status}
                  </span>
                </div>

                <AnimatePresence>
                  {isFocused && (thought || tool || agent.specialized_task) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 space-y-1.5">
                        {agent.specialized_task && (
                          <p className="text-[10px] text-slate-500 leading-snug line-clamp-2">
                            {agent.specialized_task}
                          </p>
                        )}
                        {thought && (
                          <div className="px-2 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-800/30">
                            <p className="text-[10px] text-indigo-700/80 italic leading-snug line-clamp-3">
                              💭 {thought}
                            </p>
                          </div>
                        )}
                        {tool && (
                          <div className="px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
                            <p className="text-[10px] font-mono text-slate-500 truncate">
                              🔧 {tool}
                            </p>
                          </div>
                        )}
                        <p className="text-[9px] font-mono text-slate-700 truncate">{agent.id}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Right Panel: Activity Feed ───────────────────────────────────────────────
function ActivityPanel({ focusedAgentId, onFocusAgent }: {
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
}) {
  const { wsEvents, hiveAgents } = useHiveStore();

  const agentRoles = useMemo(
    () => Object.fromEntries(hiveAgents.map(a => [a.id, a.role])),
    [hiveAgents]
  );
  const activeSet = useMemo(
    () => new Set(hiveAgents.filter(a => a.status === "working" || a.status === "thinking").map(a => a.id)),
    [hiveAgents]
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-200 shrink-0">
        <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
          <MessageSquare className="w-3 h-3 text-slate-600" />
        </div>
        <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Activity Stream</span>
        {wsEvents.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-slate-600">{wsEvents.length}</span>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <CollaborationFeed
          events={wsEvents}
          agentRoles={agentRoles}
          focusedAgentId={focusedAgentId}
          onFocusAgent={onFocusAgent}
          activeAgents={activeSet}
          className="h-full"
        />
      </div>
    </div>
  );
}

// ─── Resource Monitor Bar ─────────────────────────────────────────────────────
function ResourceBar() {
  const { hiveAgents, charCount, provider, budgetLimit, isRunning, hiveId } = useHiveStore();
  const COST_MAP = { google: 0.00025, openai: 0.005, anthropic: 0.003 };
  const tokenEst = Math.round(charCount / 4);
  const costEst  = (tokenEst / 1000) * (COST_MAP[provider as keyof typeof COST_MAP] ?? 0.003);
  const budgetPct = Math.min(100, (costEst / budgetLimit) * 100);
  const over      = costEst >= budgetLimit;
  const active    = hiveAgents.filter(a => a.status === "working" || a.status === "thinking").length;
  const done      = hiveAgents.filter(a => a.status === "completed").length;
  const total     = hiveAgents.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (total === 0 && !isRunning) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-200 shrink-0 text-[11px] bg-slate-50/50">
      {hiveId && (
        <span className="font-mono text-slate-700">#{hiveId.slice(0, 8)}</span>
      )}
      <div className="w-px h-4 bg-slate-100" />

      <div className="flex items-center gap-1.5 text-slate-500">
        <Cpu className="w-3 h-3" />
        <span>{active > 0 ? (
          <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.4, repeat: Infinity }} className="text-indigo-600 font-semibold">{active} active</motion.span>
        ) : null}</span>
        <span className="text-slate-600"> {done}/{total} done</span>
      </div>
      <div className="w-px h-4 bg-slate-100" />

      {charCount > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Brain className="w-3 h-3" />
            <span className="font-mono text-slate-500">{tokenEst.toLocaleString()} tok</span>
          </div>
          <div className="w-px h-4 bg-slate-100" />
        </>
      )}

      {charCount > 0 && (
        <div className="flex items-center gap-1.5">
          <span className={cn("font-mono font-semibold", over ? "text-red-600" : "text-emerald-600")}>
            ${costEst.toFixed(3)}
          </span>
          <span className="text-slate-700">/ ${budgetLimit}</span>
          {over && <AlertTriangle className="w-3 h-3 text-red-600" />}
        </div>
      )}

      {total > 0 && (
        <div className="flex-1 flex items-center gap-2 ml-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden max-w-40">
            <motion.div
              className={cn("h-full rounded-full", over ? "bg-red-500" : budgetPct > 70 ? "bg-amber-400" : "bg-indigo-500")}
              style={{ width: `${progressPct}%` }}
              layout
              transition={{ type: "spring", stiffness: 80 }}
            />
          </div>
          <span className="text-slate-600 font-mono">{progressPct}%</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OrchestrationPage() {
  const {
    hiveId, isRunning, isPaused, hiveAgents,
    thoughts, toolCalls, setHiveId, setIsRunning,
    setIsPaused, setSessionStatus, setHiveAgents,
    clearSession, provider, budgetLimit, setBudgetLimit, setProvider,
    pendingReview, setPendingReview, charCount,
    preparingSpawnSet, managerPulse, bucketTasks, wsEvents, focusedTaskId,
  } = useHiveStore();

  const [focusedAgentId,   setFocusedAgentId]   = useState<string | null>(null);
  const [activePanel,      setActivePanel]      = useState<"session" | "roster" | "activity">("session");
  const [isKilling,        setIsKilling]        = useState(false);
  const [isAnalyzing,      setIsAnalyzing]      = useState(false);
  // Tracks which agents have been shown (for isNewlySpawned detection in graph)
  const [spawnedSet,       setSpawnedSet]       = useState<Set<string>>(new Set());
  // Swarm handoff pulses — collected from HANDOFF ws events, auto-expire after 3s
  const [handoffPulses,    setHandoffPulses]    = useState<Array<{ id: string; fromRole: string; toRole: string; startedAt: number }>>([]);

  // Build agent → active task mapping from bucket
  const activeTasksByAgent = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const task of bucketTasks) {
      if (task.status === "IN_PROGRESS" && task.assigned_agent_id) {
        map[task.assigned_agent_id] = task.title;
      }
    }
    return map;
  }, [bucketTasks]);

  // Track newly-spawned agents for entry animation
  useMemo(() => {
    const newIds = hiveAgents.map(a => a.id).filter(id => !spawnedSet.has(id));
    if (newIds.length > 0) {
      setSpawnedSet(prev => {
        const next = new Set(prev);
        newIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [hiveAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  const COST_MAP = { google: 0.00025, openai: 0.005, anthropic: 0.003 };
  const tokenEst  = Math.round(charCount / 4);
  const costEst   = (tokenEst / 1000) * (COST_MAP[provider as keyof typeof COST_MAP] ?? 0.003);
  const over      = costEst >= budgetLimit;
  const agentCount = hiveAgents.length;
  const activeCnt  = hiveAgents.filter(a => a.status === "working" || a.status === "thinking").length;
  const doneCnt    = hiveAgents.filter(a => a.status === "completed").length;
  const tokenStats = agentCount > 0 ? { tokens: tokenEst, cost: costEst, agentCount, doneCount: doneCnt } : undefined;

  // Collect new HANDOFF events and auto-expire them after 3s
  const processedHandoffs = useRef<Set<string>>(
    new Set(wsEvents.filter(e => e.event_type === "HANDOFF").map(e => e.id))
  );

  useEffect(() => {
    const unseen = wsEvents.filter(
      e => e.event_type === "HANDOFF" && !processedHandoffs.current.has(e.id)
    );

    if (unseen.length > 0) {
      const newHandoffs = unseen.map((e, i) => {
        processedHandoffs.current.add(e.id);
        const d = (typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
        return {
          id: `${e.id}-${Date.now()}-${i}`, // Ensure strictly unique key
          fromRole: String(d.from_role ?? ""),
          toRole: String(d.to_role ?? ""),
          startedAt: Date.now(),
        };
      });

      setHandoffPulses(prev => [...prev, ...newHandoffs].slice(-5));

      newHandoffs.forEach(h => {
        setTimeout(() => {
          setHandoffPulses(prev => prev.filter(p => p.id !== h.id));
        }, 3000);
      });
    }
  }, [wsEvents]);

  const handleHiveExecute = async (
    prompt: string, prov: string, model: string,
    opts?: { budget_limit?: number; run_qa?: boolean; require_review?: boolean }
  ) => {
    setIsRunning(true); setIsPaused(false);
    setHiveAgents([]); clearSession();
    setSpawnedSet(new Set());
    setProvider(prov); setBudgetLimit(opts?.budget_limit ?? 2.0);
    setSessionStatus("running");
    setActivePanel("roster");

    try {
      const r = await executeHive({ prompt, provider: prov, model, ...opts });
      setHiveId(r.hive_id);
      const close = streamHiveLogs(
        r.hive_id,
        () => {},
        (agents) => setHiveAgents(agents),
        (st) => { setSessionStatus(st as "idle"); setIsRunning(false); close(); },
        () => setIsRunning(false)
      );
    } catch { setIsRunning(false); setSessionStatus("failed"); }
  };

  const handleHiveAnalyze = async (
    requirement: string, prov: string, model: string,
  ) => {
    // Clear previous session state
    setHiveAgents([]); clearSession();
    setProvider(prov);
    setSessionStatus("running");
    setIsRunning(true);
    setIsAnalyzing(true);
    setActivePanel("roster");

    try {
      const r = await analyzeRequirement({
        requirement,
        provider: prov,
        model,
        hive_id: hiveId || undefined,
      });
      setHiveId(r.hive_id);

      // Subscribe to streaming events so graph renders agents live
      // (BA → Workers all on same hive stream)
      const close = streamHiveLogs(
        r.hive_id,
        () => {},
        (agents) => setHiveAgents(agents),
        (st) => { setSessionStatus(st as "idle"); setIsRunning(false); setIsAnalyzing(false); close(); },
        () => { setIsRunning(false); setIsAnalyzing(false); }
      );
    } catch (e) {
      console.error("Analyze:", e);
      setSessionStatus("failed");
      setIsRunning(false);
      setIsAnalyzing(false);
    }
  };

  const handleKill = async () => {
    if (!hiveId || isKilling) return;
    setIsKilling(true);
    try {
      await killHiveSession(hiveId);
      setSessionStatus("killed"); setIsRunning(false);
    } catch (e) { console.error("Kill:", e); }
    finally { setIsKilling(false); }
  };

  const LEFT_TABS = [
    { id: "session"  as const, label: "Session",  icon: Zap,     badge: 0 },
    { id: "roster"   as const, label: "Agents",   icon: Users,   badge: agentCount },
    { id: "activity" as const, label: "Activity", icon: MessageSquare, badge: 0 },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-slate-200 flex items-center justify-between px-5 py-2.5 shrink-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-indigo-50 border border-indigo-200 flex items-center justify-center">
            <Network className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <span className="text-sm font-semibold text-slate-900">Agent Swarm</span>
          <span className="hidden sm:block text-xs text-slate-500 border-l border-slate-200 pl-2.5 ml-0.5">
            Autonomous hand-off orchestration
          </span>
        </div>

        <div className="flex items-center gap-2">
          {agentCount > 0 && (
            <div className="hidden md:flex items-center gap-3 text-[11px] text-slate-500 px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 shadow-sm">
              <span><span className="text-slate-800 font-semibold">{activeCnt}</span> active</span>
              <span className="w-px h-3 bg-slate-200" />
              <span><span className="text-emerald-600 font-semibold">{doneCnt}</span> done</span>
              <span className="w-px h-3 bg-slate-200" />
              <span className={cn("font-mono font-semibold", over ? "text-red-600" : "text-slate-600")}>
                ${costEst.toFixed(3)}
              </span>
            </div>
          )}

          {isRunning && hiveId && (
            <button
              onClick={handleKill}
              disabled={isKilling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-50"
            >
              {isKilling ? <Loader2 className="w-3 h-3 animate-spin" /> : <StopCircle className="w-3 h-3" />}
              {isKilling ? "Stopping…" : "Stop"}
            </button>
          )}

          {isRunning && (
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-700/60 transition-colors"
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {isPaused ? "Resume" : "Pause"}
            </button>
          )}
        </div>
      </header>

      {/* ── Main Body: 3-Column Layout ─────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── LEFT PANEL ─────────────────────────────────────────────────── */}
        <aside className="w-[340px] shrink-0 border-r border-slate-200 flex flex-col overflow-hidden bg-slate-50/50">
          {/* Tab switcher */}
          <div className="flex border-b border-slate-200 shrink-0 bg-white">
            {LEFT_TABS.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => setActivePanel(id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold transition-all relative",
                  activePanel === id
                    ? "text-indigo-600 bg-indigo-50/50"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                )}
              >
                <Icon className="w-3 h-3" />
                {label}
                {badge > 0 && (
                  <span className={cn(
                    "text-[9px] font-mono px-1 rounded-full",
                    activePanel === id ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
                  )}>
                    {badge}
                  </span>
                )}
                {activePanel === id && (
                  <motion.div
                    layoutId="left-panel-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activePanel === "session" && (
              <SessionPanel
                isRunning={isRunning}
                isAnalyzing={isAnalyzing}
                onExecute={handleHiveExecute}
                onAnalyze={handleHiveAnalyze}
              />
            )}
            {activePanel === "roster" && (
              <RosterPanel focusedAgentId={focusedAgentId} onFocusAgent={setFocusedAgentId} />
            )}
            {activePanel === "activity" && (
              <ActivityPanel focusedAgentId={focusedAgentId} onFocusAgent={setFocusedAgentId} />
            )}
          </div>
        </aside>

        {/* ── CENTER: Graph Canvas ─────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          <div className="flex-1 relative w-full h-full" style={{ minHeight: 0 }}>
            <AgentGraph
              agents={hiveAgents}
              thoughts={thoughts}
              toolCalls={toolCalls}
              tokenStats={tokenStats}
              onFocusAgent={(id) => {
                setFocusedAgentId(id);
                if (id) setActivePanel("roster");
              }}
              className="h-full w-full"
              preparingSpawnSet={preparingSpawnSet}
              spawnedSet={spawnedSet}
              activeTasksByAgent={activeTasksByAgent}
              managerPulse={managerPulse}
              focusedAgentIdFromTask={focusedTaskId}
              handoffPulses={handoffPulses}
            />

            {/* Empty state */}
            {!isRunning && agentCount === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 pointer-events-none">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                      <Network className="w-8 h-8 text-slate-400" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                      <Zap className="w-2.5 h-2.5 text-indigo-600" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-500">No Active Hive</p>
                    <p className="text-xs text-slate-700 mt-1.5 max-w-[220px] leading-relaxed">
                      Configure a session or inject tasks via the Roster panel
                    </p>
                  </div>
                  {/* Inbox hint */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100/40 border border-slate-200 text-[10px] text-slate-600">
                    <Inbox className="w-3 h-3" />
                    Use &quot;New Feature&quot; to inject tasks into the running factory
                  </div>
                </div>
              </div>
            )}

            {/* Running indicator badge */}
            {isRunning && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                <motion.div
                  animate={{ opacity: [1, 0.7, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel border-indigo-700/30 text-xs font-semibold text-indigo-700 shadow-lg shadow-indigo-900/20"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  Hive Running — {activeCnt} agents active
                </motion.div>
              </div>
            )}

            {/* Manager pulse overlay hint */}
            {managerPulse && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full
                    bg-indigo-950/80 border border-indigo-200 text-xs font-semibold text-indigo-700 shadow-lg"
                >
                  <Brain className="w-3 h-3" /> Manager detected new task
                </motion.div>
              </div>
            )}
          </div>

          <ResourceBar />
        </main>
      </div>

      {/* ── Human Review Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {pendingReview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center cmd-overlay"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 20 }}
              className="w-full max-w-md mx-4"
            >
              <div className="glass-panel rounded-2xl border border-amber-800/40 p-6 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Brain className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-amber-700">Human Review Required</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Agents completed work — your approval is needed to proceed
                    </p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 mb-5 max-h-40 overflow-y-auto">
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                    {pendingReview.summary}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      const resolveId = pendingReview?.hive_id ?? hiveId;
                      if (!resolveId) return;
                      try {
                        const { resolveReview } = await import("@/lib/engine-client");
                        await resolveReview(resolveId, false);
                      } catch { /* already stale or timed-out — dismiss anyway */ }
                      setPendingReview(null);
                      setSessionStatus("failed");
                      setIsRunning(false);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-800/40 bg-red-950/20 text-red-300 text-xs font-semibold hover:bg-red-950/40 transition-colors"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                  <button
                    onClick={async () => {
                      if (!hiveId) return;
                      const { resolveReview } = await import("@/lib/engine-client");
                      await resolveReview(hiveId, true);
                      setPendingReview(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-indigo-900/30"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve & Deploy
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
