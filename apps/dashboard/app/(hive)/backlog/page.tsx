"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DragDropContext, Droppable, Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  Plus, GripVertical, Clock, CheckCircle2, AlertCircle,
  Loader2, X, Bug, Play, StopCircle, AlertTriangle,
  Zap, Inbox, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import {
  createBucketTask, deleteBucketTask, startBucketFactory, stopBucketFactory,
  type BucketTask, type BucketPriority, type BucketStartResponse,
} from "@/lib/engine-client";
import { AddTaskModal } from "@/components/add-task-modal";

// ─── Priority config ──────────────────────────────────────────────────────────
const PRIORITY_CFG: Record<BucketPriority, { label: string; dot: string; cls: string }> = {
  HIGH:   { label: "High",   dot: "bg-rose-400",   cls: "bg-rose-950/40 text-rose-300 border-rose-800/30" },
  MEDIUM: { label: "Medium", dot: "bg-amber-400",  cls: "bg-amber-950/40 text-amber-300 border-amber-800/30" },
  LOW:    { label: "Low",    dot: "bg-slate-500",  cls: "bg-slate-800/40 text-slate-400 border-slate-700/30" },
};

// ─── Kanban column definitions ────────────────────────────────────────────────
type KanbanCol = {
  id: string;
  label: string;
  statuses: string[];
  color: string;
  border: string;
  icon: React.ElementType;
  description: string;
};

const COLUMNS: KanbanCol[] = [
  {
    id: "backlog",    label: "Backlog",     statuses: ["PENDING"],
    color: "text-slate-400",  border: "border-slate-700/40",
    icon: Inbox, description: "Inbound tasks waiting to be assigned",
  },
  {
    id: "in_progress", label: "In Progress", statuses: ["IN_PROGRESS"],
    color: "text-indigo-400", border: "border-indigo-700/40",
    icon: Loader2, description: "Currently being executed by an agent",
  },
  {
    id: "completed",  label: "Done",        statuses: ["COMPLETED"],
    color: "text-emerald-400",border: "border-emerald-700/40",
    icon: CheckCircle2, description: "Successfully completed tasks",
  },
  {
    id: "failed",     label: "Failed",      statuses: ["FAILED", "CANCELLED"],
    color: "text-red-400",    border: "border-red-700/40",
    icon: AlertCircle, description: "Tasks that encountered errors",
  },
];

// ─── Task Card ────────────────────────────────────────────────────────────────
function KanbanCard({
  task, index, onDelete,
}: {
  task: BucketTask; index: number; onDelete: (id: string) => void;
}) {
  const pri     = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.MEDIUM;
  const isActive= task.status === "IN_PROGRESS";
  const isFailed= task.status === "FAILED";
  const isDone  = task.status === "COMPLETED";
  const isDebug = task.parent_task_id != null;
  const [showError, setShowError] = useState(false);

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "group relative rounded-xl border p-3.5 mb-2 transition-all duration-200 select-none",
            snapshot.isDragging && "rotate-1 shadow-2xl shadow-black/50",
            isActive && "border-indigo-600/50 bg-indigo-950/30 shadow-indigo-900/20 shadow-lg",
            isDone   && "border-emerald-800/30 bg-slate-900/20 opacity-60",
            isFailed && "border-red-800/30 bg-red-950/10",
            isDebug  && "border-amber-800/30 bg-amber-950/10",
            !isActive && !isDone && !isFailed && !isDebug &&
              "border-slate-700/30 bg-[#111118]/80 hover:border-slate-600/50 hover:bg-[#111118]",
          )}
        >
          {/* Grip handle */}
          <div
            {...provided.dragHandleProps}
            className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 transition-opacity cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-3.5 h-3.5 text-slate-500" />
          </div>

          {/* Debug badge */}
          {isDebug && (
            <div className="absolute -top-2 left-3 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-900/70 border border-amber-700/50 text-amber-300">
              <Bug className="w-2.5 h-2.5" /> AUTO-DEBUG
            </div>
          )}

          {/* Delete button (pending only) */}
          {task.status === "PENDING" && (
            <button
              onClick={() => onDelete(task.id)}
              className="absolute right-2 top-2 p-0.5 rounded text-slate-700 hover:text-red-400 hover:bg-red-950/40 opacity-0 group-hover:opacity-100 transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          {/* Content */}
          <div className="pl-4">
            <p className="text-xs font-medium text-slate-200 leading-snug pr-4 mb-2">{task.title}</p>

            {/* Tags row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md border flex items-center gap-1", pri.cls)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", pri.dot)} />
                {pri.label}
              </span>
              {task.retry_count > 0 && (
                <span className="text-[10px] text-amber-500 font-mono">×{task.retry_count} retry</span>
              )}
              {task.assigned_role && isActive && (
                <span className="text-[10px] text-indigo-300 font-semibold capitalize px-1.5 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-800/30">
                  → {task.assigned_role.replace(/_/g, " ")}
                </span>
              )}
              {isFailed && task.error_log && (
                <button
                  onClick={() => setShowError(v => !v)}
                  className="text-[10px] text-red-400 flex items-center gap-0.5 hover:underline"
                >
                  <Info className="w-2.5 h-2.5" /> error
                </button>
              )}
            </div>
          </div>

          {/* Error detail */}
          <AnimatePresence>
            {showError && task.error_log && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <p className="text-[10px] font-mono text-red-400/80 bg-red-950/40 rounded-lg p-2 mt-2 leading-relaxed whitespace-pre-wrap break-all line-clamp-4">
                  {task.error_log}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

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
        </div>
      )}
    </Draggable>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────
function KanbanColumn({
  col, tasks, onDelete, onAddClick,
}: {
  col: KanbanCol; tasks: BucketTask[];
  onDelete: (id: string) => void;
  onAddClick?: () => void;
}) {
  const ColIcon = col.icon;
  const isActive = col.id === "in_progress";

  return (
    <div className="flex flex-col min-w-[260px] max-w-[320px] flex-1">
      {/* Column header */}
      <div className={cn("flex items-center justify-between px-3 py-3 mb-3 rounded-xl border", col.border, "bg-[#0d0d14]")}>
        <div className="flex items-center gap-2">
          {isActive ? (
            <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
              <ColIcon className={cn("w-3.5 h-3.5", col.color)} />
            </motion.div>
          ) : (
            <ColIcon className={cn("w-3.5 h-3.5", col.color)} />
          )}
          <span className={cn("text-xs font-bold", col.color)}>{col.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 font-mono">
            {tasks.length}
          </span>
        </div>
        {col.id === "backlog" && onAddClick && (
          <button
            onClick={onAddClick}
            className="w-5 h-5 rounded-md bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-700/30 flex items-center justify-center transition-colors"
          >
            <Plus className="w-3 h-3 text-indigo-400" />
          </button>
        )}
      </div>

      {/* Drop zone */}
      <Droppable droppableId={col.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex-1 min-h-[200px] rounded-xl p-2 transition-all duration-200",
              snapshot.isDraggingOver
                ? "bg-indigo-950/20 border border-indigo-700/30"
                : "bg-transparent border border-transparent"
            )}
          >
            <AnimatePresence>
              {tasks.length === 0 && !snapshot.isDraggingOver ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-24 gap-1.5 text-slate-700"
                >
                  <ColIcon className="w-5 h-5" />
                  <p className="text-[10px] text-center">{col.description}</p>
                </motion.div>
              ) : (
                tasks.map((task, index) => (
                  <KanbanCard key={task.id} task={task} index={index} onDelete={onDelete} />
                ))
              )}
            </AnimatePresence>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BacklogPage() {
  const { bucketTasks, setBucketTasks, isRunning, setIsRunning, setSessionStatus, setHiveId, provider, budgetLimit } = useHiveStore();
  const [showModal,   setShowModal]   = useState(false);
  const [isStarting,  setIsStarting]  = useState(false);
  const [isStopping,  setIsStopping]  = useState(false);
  const [engineAvailable, setEngineAvailable] = useState<boolean | null>(null);

  // Check engine
  useEffect(() => {
    fetch("/api/engine/bucket/tasks")
      .then(r => setEngineAvailable(r.ok))
      .catch(() => setEngineAvailable(false));
  }, []);

  const handleAddTask = useCallback(async (title: string, desc: string, priority: BucketPriority) => {
    if (engineAvailable) {
      const created = await createBucketTask(title, desc, priority);
      setBucketTasks([...bucketTasks, created]);
    } else {
      const fake: BucketTask = {
        id: Math.random().toString(36).slice(2, 10), title,
        description: desc, priority, status: "PENDING",
        hive_id: null, assigned_agent_id: null, assigned_role: null,
        error_log: null, retry_count: 0, max_retries: 2,
        parent_task_id: null, created_at: new Date().toISOString(),
      };
      setBucketTasks([...bucketTasks, fake]);
    }
  }, [engineAvailable, bucketTasks, setBucketTasks]);

  const handleDelete = useCallback(async (id: string) => {
    if (engineAvailable) await deleteBucketTask(id);
    setBucketTasks(bucketTasks.filter(t => t.id !== id));
  }, [engineAvailable, bucketTasks, setBucketTasks]);

  const handleStartFactory = useCallback(async () => {
    if (!engineAvailable) return;
    setIsStarting(true);
    try {
      const res: BucketStartResponse = await startBucketFactory({
        provider, model: undefined, budget_limit: budgetLimit, run_qa: true, stop_on_failure: false,
      });
      if (res.hive_id) {
        setHiveId(res.hive_id);
        setIsRunning(true);
        setSessionStatus("running");
      }
    } catch (e) { console.error("Factory start:", e); }
    finally { setIsStarting(false); }
  }, [engineAvailable, provider, budgetLimit, setHiveId, setIsRunning, setSessionStatus]);

  const handleStopFactory = useCallback(async () => {
    if (!engineAvailable) return;
    setIsStopping(true);
    try {
      await stopBucketFactory();
      setIsRunning(false);
      setSessionStatus("idle");
    } catch (e) { console.error("Factory stop:", e); }
    finally { setIsStopping(false); }
  }, [engineAvailable, setIsRunning, setSessionStatus]);

  // DnD — visual-only rearrangement (order within same col)
  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const srcCol  = result.source.droppableId;
    const dstCol  = result.destination.droppableId;
    if (srcCol === dstCol) {
      // Reorder within column
      const colStatuses = COLUMNS.find(c => c.id === dstCol)?.statuses ?? [];
      const colItems    = bucketTasks.filter(t => colStatuses.includes(t.status));
      const [moved]     = colItems.splice(result.source.index, 1);
      colItems.splice(result.destination.index, 0, moved);
      const others = bucketTasks.filter(t => !colStatuses.includes(t.status));
      setBucketTasks([...others, ...colItems]);
    }
    // Cross-column drag is informational only — real status changes come from the engine
  }, [bucketTasks, setBucketTasks]);

  const pendingCnt = bucketTasks.filter(t => t.status === "PENDING").length;
  const factoryRunning = isRunning;

  // Map tasks to columns
  const colTasks = (col: KanbanCol) =>
    bucketTasks.filter(t => col.statuses.includes(t.status));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-white/5 flex items-center justify-between px-6 py-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Task Backlog</h1>
          <p className="text-xs text-slate-500 mt-0.5">Kanban Board · Drag to reorder, agents auto-move cards</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Engine status */}
          {engineAvailable === false && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-800/30">
              <AlertTriangle className="w-3.5 h-3.5" /> Engine offline
            </div>
          )}

          {/* Factory controls */}
          {factoryRunning ? (
            <button
              onClick={handleStopFactory}
              disabled={isStopping}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-red-950/40 border border-red-800/40 text-red-300 hover:bg-red-950/60 transition-colors disabled:opacity-50"
            >
              {isStopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
              {isStopping ? "Stopping…" : "Stop Factory"}
            </button>
          ) : (
            <button
              onClick={handleStartFactory}
              disabled={isStarting || pendingCnt === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {isStarting ? "Starting…" : pendingCnt === 0 ? "Add Tasks First" : `Start Factory (${pendingCnt})`}
            </button>
          )}

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Task
          </button>
        </div>
      </header>

      {/* ── Progress Strip ───────────────────────────────────────────────── */}
      {bucketTasks.length > 0 && (
        <div className="px-6 py-3 border-b border-white/5 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Zap className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-semibold text-slate-300">
              {bucketTasks.filter(t => t.status === "COMPLETED").length}
            </span>
            <span>of</span>
            <span className="font-semibold text-slate-300">{bucketTasks.length}</span>
            <span>tasks complete</span>
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden max-w-sm">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500"
              style={{
                width: `${bucketTasks.length > 0
                  ? (bucketTasks.filter(t => t.status === "COMPLETED").length / bucketTasks.length) * 100
                  : 0}%`
              }}
              layout
              transition={{ type: "spring", stiffness: 80 }}
            />
          </div>
          {factoryRunning && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="flex items-center gap-1.5 text-xs text-indigo-400 font-semibold"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              Factory running
            </motion.div>
          )}
        </div>
      )}

      {/* ── Kanban Board ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                col={col}
                tasks={colTasks(col)}
                onDelete={handleDelete}
                onAddClick={col.id === "backlog" ? () => setShowModal(true) : undefined}
              />
            ))}
          </div>
        </DragDropContext>
      </div>

      {/* ── Add Task Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <AddTaskModal
            onAdd={handleAddTask}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
