"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, X, GripVertical, Clock, CheckCircle2,
  AlertCircle, Loader2, Edit3, Check,
  Inbox, Cpu, Play, StopCircle, Filter,
  RefreshCw, Zap, AlertTriangle, Bug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createBucketTask, listBucketTasks, updateBucketTask, deleteBucketTask,
  streamBucketProgress, startBucketFactory, stopBucketFactory,
  type BucketTask, type BucketPriority, type BucketProgressWithTasks,
  type BucketStartResponse,
} from "@/lib/engine-client";

// ─── Priority config ──────────────────────────────────────────────────────────
const PRIORITY_CFG: Record<BucketPriority, { label: string; cls: string; dot: string; weight: number }> = {
  HIGH:   { label: "High",   cls: "priority-high",   dot: "bg-red-400",    weight: 0 },
  MEDIUM: { label: "Medium", cls: "priority-medium", dot: "bg-amber-400",  weight: 1 },
  LOW:    { label: "Low",    cls: "priority-low",    dot: "bg-slate-500",  weight: 2 },
};

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string; Icon: React.ElementType; animate: boolean }> = {
  PENDING:     { label: "Pending",     cls: "status-pending",     Icon: Clock,        animate: false },
  IN_PROGRESS: { label: "Running",     cls: "status-in-progress", Icon: Loader2,      animate: true  },
  COMPLETED:   { label: "Completed",   cls: "status-completed",   Icon: CheckCircle2, animate: false },
  FAILED:      { label: "Failed",      cls: "status-failed",      Icon: AlertCircle,  animate: false },
  CANCELLED:   { label: "Cancelled",   cls: "status-pending",     Icon: X,            animate: false },
};

// ─── Add Task Modal ───────────────────────────────────────────────────────────
interface AddTaskModalProps {
  onAdd: (title: string, desc: string, priority: BucketPriority) => Promise<void>;
  onClose: () => void;
}

function AddTaskModal({ onAdd, onClose }: AddTaskModalProps) {
  const [title, setTitle]       = useState("");
  const [desc, setDesc]         = useState("");
  const [priority, setPriority] = useState<BucketPriority>("MEDIUM");
  const [loading, setLoading]   = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    await onAdd(title.trim(), desc.trim(), priority);
    setLoading(false);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center cmd-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="glass-panel rounded-2xl w-full max-w-md mx-4 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center">
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Add Task to Bucket</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">Title *</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Implement user authentication API"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700/60 text-sm text-slate-100 placeholder-slate-600
                focus:outline-none focus:ring-1 focus:ring-indigo-500/60 focus:border-indigo-500/40 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional context or acceptance criteria..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700/60 text-sm text-slate-100 placeholder-slate-600
                focus:outline-none focus:ring-1 focus:ring-indigo-500/60 focus:border-indigo-500/40 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">Priority</label>
            <div className="flex gap-2">
              {(["LOW", "MEDIUM", "HIGH"] as BucketPriority[]).map((p) => {
                const cfg = PRIORITY_CFG[p];
                const sel = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-all",
                      sel ? cfg.cls + " ring-1 ring-inset ring-current/30" : "bg-slate-800/60 text-slate-500 border-slate-700/40 hover:border-slate-600"
                    )}
                  >
                    <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold border border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || loading}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {loading ? "Adding..." : "Add to Bucket"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
interface TaskCardProps {
  task: BucketTask;
  onDelete: (id: string) => void;
  onUpdatePriority: (id: string, p: BucketPriority) => void;
}

function TaskCard({ task, onDelete, onUpdatePriority }: TaskCardProps) {
  const pri = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.MEDIUM;
  const sta = STATUS_CFG[task.status] ?? STATUS_CFG.PENDING;
  const StatusIcon = sta.Icon;
  const isActive = task.status === "IN_PROGRESS";
  const isFailed = task.status === "FAILED";
  const isDone   = task.status === "COMPLETED";
  const isDebug  = task.parent_task_id != null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      className={cn(
        "group relative rounded-xl border p-3 transition-all duration-200",
        isActive && "border-indigo-600/50 bg-indigo-950/30 animate-task-highlight",
        isDone   && "border-emerald-800/30 bg-slate-900/30 opacity-70",
        isFailed && "border-red-800/30 bg-red-950/10",
        isDebug  && "border-amber-800/30 bg-amber-950/10",
        !isActive && !isDone && !isFailed && !isDebug && "border-slate-700/30 bg-slate-900/50 hover:border-slate-600/50 hover:bg-slate-900/80",
      )}
    >
      {/* Debug badge */}
      {isDebug && (
        <div className="absolute -top-1.5 left-3 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-900/70 border border-amber-700/50 text-amber-300">
          <Bug className="w-2.5 h-2.5" /> AUTO-DEBUG
        </div>
      )}

      {/* Actions */}
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {task.status === "PENDING" && (
          <button
            onClick={() => onDelete(task.id)}
            className="p-0.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-950/40 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Title */}
      <p className="text-xs font-medium text-slate-200 leading-snug pr-5 mb-2">{task.title}</p>

      {/* Tags */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md tracking-wide", pri.cls)}>
          {pri.label}
        </span>
        <span className={cn("flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md", sta.cls)}>
          <StatusIcon className={cn("w-2.5 h-2.5", sta.animate && "animate-spin")} />
          {sta.label}
        </span>
        {task.retry_count > 0 && (
          <span className="text-[10px] text-amber-500 font-mono">×{task.retry_count} retry</span>
        )}
        {task.assigned_role && isActive && (
          <span className="text-[10px] text-indigo-300 font-semibold capitalize px-1.5 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-800/30">
            → {task.assigned_role.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Error log (collapsed) */}
      {isFailed && task.error_log && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-red-500 cursor-pointer">View error</summary>
          <p className="mt-1 text-[10px] font-mono text-red-400/80 bg-red-950/40 rounded p-1.5 leading-relaxed whitespace-pre-wrap break-all line-clamp-4">
            {task.error_log}
          </p>
        </details>
      )}

      {/* Active shimmer */}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-px overflow-hidden rounded-b-xl">
          <motion.div
            className="h-full bg-gradient-to-r from-transparent via-indigo-500 to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}
    </motion.div>
  );
}

// ─── Factory Controls + Progress Bar ─────────────────────────────────────────
interface FactoryControlsProps {
  progress: BucketProgressWithTasks | null;
  provider: string;
  budgetLimit: number;
  isStarting: boolean;
  isStopping: boolean;
  onStart: () => void;
  onStop: () => void;
}

function FactoryControls({
  progress, provider, budgetLimit, isStarting, isStopping, onStart, onStop,
}: FactoryControlsProps) {
  const running = progress?.factory_running ?? false;
  const total   = progress?.total ?? 0;
  const done    = progress?.completed ?? 0;
  const failed  = progress?.failed ?? 0;
  const pct     = progress?.progress_pct ?? 0;
  const pending = progress?.pending ?? 0;

  return (
    <div className="px-4 pb-3 shrink-0 space-y-3">
      {/* Progress bar */}
      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Zap className="w-3 h-3 text-indigo-400" />
              <span className="font-semibold text-slate-300">{done}/{total}</span>
              <span className="text-slate-600">tasks</span>
              {failed > 0 && (
                <span className="text-red-400 font-semibold">{failed} failed</span>
              )}
            </div>
            <span className="text-xs font-mono text-slate-500">{pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800/80 overflow-hidden">
            {/* Completed */}
            <motion.div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${(done / total) * 100}%` }}
              layout
              transition={{ type: "spring", stiffness: 80 }}
            />
          </div>
          {running && (
            <div className="flex items-center gap-1.5">
              <motion.div
                className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
              <span className="text-[10px] text-indigo-400 font-medium">
                Factory running — {pending} task{pending !== 1 ? "s" : ""} remaining
              </span>
            </div>
          )}
        </div>
      )}

      {/* Start / Stop Factory button */}
      {running ? (
        <button
          id="stop-factory-btn"
          onClick={onStop}
          disabled={isStopping}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold
            bg-red-950/40 border border-red-800/40 text-red-300 hover:bg-red-950/60 transition-colors disabled:opacity-50"
        >
          {isStopping
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <StopCircle className="w-3.5 h-3.5" />}
          {isStopping ? "Stopping..." : "Stop Factory"}
        </button>
      ) : (
        <button
          id="start-factory-btn"
          onClick={onStart}
          disabled={isStarting || pending === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold
            bg-gradient-to-r from-indigo-600 to-violet-600 text-white
            hover:opacity-90 transition-opacity shadow-lg shadow-indigo-900/30
            disabled:opacity-40 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700"
        >
          {isStarting
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Play className="w-3.5 h-3.5" />}
          {isStarting
            ? "Starting Factory..."
            : pending === 0
              ? "Add Tasks First"
              : `Start Factory (${pending} task${pending !== 1 ? "s" : ""})`}
        </button>
      )}
    </div>
  );
}

// ─── Main TaskBucket Component ────────────────────────────────────────────────
interface TaskBucketProps {
  provider?: string;
  model?: string;
  budgetLimit?: number;
  className?: string;
  // Optional: called when factory starts (so page.tsx can track the hive_id)
  onFactoryStart?: (hiveId: string) => void;
  onFactoryStop?: () => void;
}

export function TaskBucket({
  provider = "google",
  model,
  budgetLimit = 2.0,
  className,
  onFactoryStart,
  onFactoryStop,
}: TaskBucketProps) {
  const [tasks,     setTasks]     = useState<BucketTask[]>([]);
  const [progress,  setProgress]  = useState<BucketProgressWithTasks | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search,    setSearch]    = useState("");
  const [filterSt,  setFilterSt]  = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [engineAvailable, setEngineAvailable] = useState<boolean | null>(null);
  const sseRef = useRef<(() => void) | null>(null);

  // ── Check engine availability ─────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/engine/bucket/tasks")
      .then(r => { setEngineAvailable(r.ok); })
      .catch(() => setEngineAvailable(false));
  }, []);

  // ── Stream progress from engine ───────────────────────────────────────────
  useEffect(() => {
    if (!engineAvailable) return;

    // Initial load
    listBucketTasks().then(setTasks).catch(() => {});

    // SSE progress stream
    const close = streamBucketProgress(
      (data) => {
        setProgress(data);
        setTasks(data.tasks ?? []);
      },
      () => {
        // On SSE error: fall back to polling
        const interval = setInterval(() => {
          listBucketTasks().then(setTasks).catch(() => {});
        }, 3000);
        return () => clearInterval(interval);
      }
    );
    sseRef.current = close;
    return () => { close(); sseRef.current = null; };
  }, [engineAvailable]);

  // ── Task CRUD ─────────────────────────────────────────────────────────────
  const handleAddTask = useCallback(async (
    title: string,
    desc: string,
    priority: BucketPriority
  ) => {
    if (engineAvailable) {
      // Server-persisted
      const created = await createBucketTask(title, desc, priority);
      setTasks(prev => [...prev, created]);
    } else {
      // Offline fallback: local state only
      const fake: BucketTask = {
        id: Math.random().toString(36).slice(2, 10),
        title, description: desc, priority,
        status: "PENDING",
        hive_id: null, assigned_agent_id: null, assigned_role: null,
        error_log: null, retry_count: 0, max_retries: 2,
        parent_task_id: null,
        created_at: new Date().toISOString(),
      };
      setTasks(prev => [...prev, fake]);
    }
  }, [engineAvailable]);

  const handleDeleteTask = useCallback(async (id: string) => {
    if (engineAvailable) {
      await deleteBucketTask(id);
    }
    setTasks(prev => prev.filter(t => t.id !== id));
  }, [engineAvailable]);

  const handleUpdatePriority = useCallback(async (id: string, p: BucketPriority) => {
    if (engineAvailable) {
      await updateBucketTask(id, { priority: p });
    }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: p } : t));
  }, [engineAvailable]);

  // ── Factory controls ──────────────────────────────────────────────────────
  const handleStartFactory = useCallback(async () => {
    if (!engineAvailable) return;
    setIsStarting(true);
    try {
      const res: BucketStartResponse = await startBucketFactory({
        provider,
        model,
        budget_limit: budgetLimit,
        run_qa: true,
        stop_on_failure: false,
      });
      if (res.hive_id) {
        onFactoryStart?.(res.hive_id);
      }
    } catch (e) {
      console.error("Factory start failed:", e);
    } finally {
      setIsStarting(false);
    }
  }, [engineAvailable, provider, model, budgetLimit, onFactoryStart]);

  const handleStopFactory = useCallback(async () => {
    if (!engineAvailable) return;
    setIsStopping(true);
    try {
      await stopBucketFactory();
      onFactoryStop?.();
    } catch (e) {
      console.error("Factory stop failed:", e);
    } finally {
      setIsStopping(false);
    }
  }, [engineAvailable, onFactoryStop]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = tasks.filter(t => {
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
    const matchSt = filterSt === "all" || t.status.toLowerCase() === filterSt.toLowerCase();
    return matchSearch && matchSt;
  });

  const pendingCnt  = tasks.filter(t => t.status === "PENDING").length;
  const activeCnt   = tasks.filter(t => t.status === "IN_PROGRESS").length;
  const doneCnt     = tasks.filter(t => t.status === "COMPLETED").length;

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-200">Task Bucket</span>
          {pendingCnt > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/50">
              {pendingCnt}
            </span>
          )}
          {/* Engine status */}
          {engineAvailable === false && (
            <span className="text-[10px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-2.5 h-2.5" /> offline
            </span>
          )}
          {engineAvailable === true && (
            <motion.div
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              title="Engine connected"
            />
          )}
        </div>
        <button
          id="add-task-btn"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
            bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-sm shadow-indigo-900/30"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {/* Mini stats */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-2 shrink-0">
          {activeCnt > 0 && (
            <motion.span animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
              className="text-[10px] text-indigo-400 font-semibold">
              {activeCnt} running
            </motion.span>
          )}
          {doneCnt > 0 && <span className="text-[10px] text-emerald-600">{doneCnt} done</span>}
          {activeCnt === 0 && doneCnt === 0 && (
            <span className="text-[10px] text-slate-600">{pendingCnt} pending</span>
          )}
        </div>
      )}

      {/* Factory controls + progress */}
      <FactoryControls
        progress={progress}
        provider={provider}
        budgetLimit={budgetLimit}
        isStarting={isStarting}
        isStopping={isStopping}
        onStart={handleStartFactory}
        onStop={handleStopFactory}
      />

      {/* Search */}
      <div className="px-4 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-8 pr-8 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40
              text-xs text-slate-300 placeholder-slate-600
              focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-colors"
          />
          <button
            onClick={() => setShowFilters(v => !v)}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors",
              showFilters ? "text-indigo-400" : "text-slate-600 hover:text-slate-400"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Status filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 pb-2 shrink-0 overflow-hidden"
          >
            <div className="flex flex-wrap gap-1">
              {["all", "pending", "in_progress", "completed", "failed"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterSt(s)}
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-all capitalize",
                    filterSt === s
                      ? "bg-slate-700 text-slate-200 border-slate-500"
                      : "bg-transparent text-slate-600 border-slate-700/40 hover:border-slate-600"
                  )}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 min-h-0">
        <AnimatePresence initial={false}>
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-28 gap-2"
            >
              <Inbox className="w-6 h-6 text-slate-700" />
              <p className="text-xs text-slate-600 text-center">
                {tasks.length === 0 ? "No tasks yet. Add tasks to get started." : "No tasks match filters."}
              </p>
            </motion.div>
          ) : (
            filtered.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onDelete={handleDeleteTask}
                onUpdatePriority={handleUpdatePriority}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showModal && (
          <AddTaskModal onAdd={handleAddTask} onClose={() => setShowModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
