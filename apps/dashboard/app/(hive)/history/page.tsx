"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  History, CheckCircle2, XCircle, Clock, Loader2,
  Cpu, DollarSign, RefreshCw, ChevronDown, ChevronUp,
  FolderOpen, Network, Zap, AlertTriangle,
  StopCircle, Code2, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import {
  listHiveSessions, getHiveDetail,
  type HiveSession, type HiveDetail,
} from "@/lib/engine-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COST_PER_1K: Record<string, number> = {
  google: 0.00025, openai: 0.005, anthropic: 0.003,
};

function estimateCost(session: HiveSession): string {
  const rate = COST_PER_1K[session.provider] ?? 0.003;
  const est = session.agent_count * 0.8 * rate;
  return est < 0.001 ? "<$0.001" : `~$${est.toFixed(3)}`;
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days  > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins  > 0) return `${mins}m ago`;
  return "just now";
}

// ─── Status Config ────────────────────────────────────────────────────────────
type SCfg = { dot: string; label: string; badgeCls: string; Icon: React.ElementType };
const STATUS_CFG: Record<string, SCfg> = {
  completed: { dot: "bg-emerald-500", label: "Completed", badgeCls: "bg-emerald-50 border-emerald-200 text-emerald-700", Icon: CheckCircle2 },
  failed:    { dot: "bg-red-500",     label: "Failed",    badgeCls: "bg-red-50 border-red-200 text-red-700",     Icon: XCircle },
  running:   { dot: "bg-indigo-500 animate-pulse", label: "Running", badgeCls: "bg-indigo-50 border-indigo-200 text-indigo-700", Icon: Loader2 },
  killed:    { dot: "bg-slate-400",    label: "Killed",    badgeCls: "bg-slate-100 border-slate-200 text-slate-600",    Icon: StopCircle },
};

// ─── Detail Drawer ────────────────────────────────────────────────────────────
function DetailDrawer({ hiveId, onOpenWorkspace, onRestoreSession }: {
  hiveId: string;
  onOpenWorkspace: (id: string) => void;
  onRestoreSession: (id: string) => void;
}) {
  const [detail, setDetail] = useState<HiveDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getHiveDetail(hiveId).then(setDetail).catch(() => setDetail(null)).finally(() => setLoading(false));
  }, [hiveId]);

  if (loading) return (
    <div className="flex items-center justify-center py-5 gap-2 text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">Loading…</span>
    </div>
  );

  if (!detail) return (
    <div className="flex items-center justify-center py-5 gap-2 text-slate-400">
      <AlertTriangle className="w-4 h-4" />
      <span className="text-xs">Session details not available</span>
    </div>
  );

  return (
    <div className="px-5 py-4 space-y-4 bg-slate-50/50 border-b border-slate-200">
      {/* Full prompt */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 font-semibold">Prompt</p>
        <div className="bg-white rounded-md border border-slate-200 p-3 shadow-sm">
          <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap">{detail.prompt}</p>
        </div>
      </div>
      {/* Agent roster */}
      {detail.agents && detail.agents.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest mb-1.5">
            Agents ({detail.agents.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {detail.agents.map((agent) => (
              <span
                key={agent.id}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border font-medium capitalize",
                  agent.status === "completed" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                  agent.status === "error"     ? "bg-red-50 border-red-200 text-red-700" :
                                                  "bg-slate-100 border-slate-200 text-slate-600"
                )}
              >
                <Code2 className="w-2.5 h-2.5 shrink-0" />
                {agent.role.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onOpenWorkspace(hiveId)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-white border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 transition-all shadow-sm"
        >
          <FolderOpen className="w-3.5 h-3.5" /> View Files
        </button>
        <button
          onClick={() => onRestoreSession(hiveId)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-all shadow-sm"
        >
          <Network className="w-3.5 h-3.5" /> Replay Graph
        </button>
      </div>
    </div>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────
function SessionTableRow({
  session, isExpanded, onToggle, onOpenWorkspace, onRestoreSession,
}: {
  session: HiveSession; isExpanded: boolean;
  onToggle: () => void;
  onOpenWorkspace: (id: string) => void;
  onRestoreSession: (id: string) => void;
}) {
  const cfg = STATUS_CFG[session.status] ?? STATUS_CFG.killed;
  const StatusIcon = cfg.Icon;

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "data-table-row cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-100",
          isExpanded && "bg-slate-50/50"
        )}
      >
        {/* Status */}
        <td className="py-3 pl-5 pr-3 w-32">
          <span className={cn(
            "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded border",
            cfg.badgeCls
          )}>
            <StatusIcon className={cn("w-2.5 h-2.5", session.status === "running" && "animate-spin")} />
            {cfg.label}
          </span>
        </td>
        {/* Project / Prompt */}
        <td className="py-3 px-3">
          <p className="text-xs font-semibold text-slate-800 truncate max-w-[260px]">
            {session.prompt_preview || `Session ${session.id.slice(0, 8)}`}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-mono">#{session.id.slice(0, 8)}</p>
        </td>
        {/* Provider / Model */}
        <td className="py-3 px-3 hidden md:table-cell">
          <span className="text-[11px] text-slate-600 font-medium capitalize">{session.provider}</span>
          {session.model && (
            <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px]">{session.model}</p>
          )}
        </td>
        {/* Agents */}
        <td className="py-3 px-3 hidden sm:table-cell">
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <Cpu className="w-3.5 h-3.5 text-slate-400" />{session.agent_count}
          </span>
        </td>
        {/* Cost */}
        <td className="py-3 px-3 hidden lg:table-cell">
          <span className="text-[11px] font-medium text-slate-500">{estimateCost(session)}</span>
        </td>
        {/* Date */}
        <td className="py-3 px-3 hidden sm:table-cell">
          <span className="text-[11px] font-medium text-slate-500">{timeAgo(session.created_at)}</span>
        </td>
        {/* Expand */}
        <td className="py-3 pl-3 pr-5 text-right">
          {isExpanded
            ? <ChevronUp className="w-4 h-4 text-slate-400 ml-auto" />
            : <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />}
        </td>
      </tr>
      {/* Expandable detail row */}
      {isExpanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <AnimatePresence>
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <DetailDrawer
                  hiveId={session.id}
                  onOpenWorkspace={onOpenWorkspace}
                  onRestoreSession={onRestoreSession}
                />
              </motion.div>
            </AnimatePresence>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const router = useRouter();
  const { setHiveId, setSessionStatus } = useHiveStore();
  const [sessions,   setSessions]   = useState<HiveSession[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter,     setFilter]     = useState("all");
  const [search,     setSearch]     = useState("");

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setSessions(await listHiveSessions().catch(() => []));
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleOpenWorkspace  = useCallback((id: string) => router.push(`/workspace?session=${id}`), [router]);
  const handleRestoreSession = useCallback((id: string) => {
    setHiveId(id); setSessionStatus("completed"); router.push("/orchestration");
  }, [setHiveId, setSessionStatus, router]);

  const STATUS_FILTERS = ["all", "completed", "failed", "running", "killed"];

  const filtered = sessions
    .filter(s => filter === "all" || s.status === filter)
    .filter(s => !search.trim() || s.prompt_preview?.toLowerCase().includes(search.toLowerCase()) || s.id.startsWith(search));

  const stats = {
    total:     sessions.length,
    completed: sessions.filter(s => s.status === "completed").length,
    failed:    sessions.filter(s => s.status === "failed").length,
    agents:    sessions.reduce((a, s) => a + s.agent_count, 0),
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-slate-200 flex items-center justify-between px-6 py-3.5 shrink-0 bg-slate-50/50">
        <div>
          <h1 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" /> Session Archive
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">All hive runs persisted in PostgreSQL</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Stats strip */}
          <div className="hidden md:flex items-center gap-3 text-[11px] text-slate-500">
            <span><span className="font-semibold text-slate-900">{stats.total}</span> total</span>
            <span><span className="font-semibold text-emerald-600">{stats.completed}</span> completed</span>
            {stats.failed > 0 && <span><span className="font-semibold text-red-600">{stats.failed}</span> failed</span>}
            <span><span className="font-semibold text-indigo-600">{stats.agents}</span> agents</span>
          </div>
          <button
            onClick={fetchSessions}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition-all disabled:opacity-40 bg-white shadow-sm"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      {/* ── Toolbar: Search + Filter ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-200 shrink-0 bg-white">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="w-full pl-8 pr-3 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-sm"
          />
        </div>
        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[10px] font-bold border capitalize transition-all",
                filter === f
                  ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm"
                  : "bg-transparent border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-slate-50/30">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm font-medium">Loading history…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 shadow-sm flex items-center justify-center mb-4 text-slate-400">
              <History className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700 mb-1">
              {filter === "all" && !search ? "No sessions recorded yet" : "No matching sessions"}
            </p>
            {filter === "all" && !search && (
              <button
                onClick={() => router.push("/backlog")}
                className="flex items-center gap-2 px-4 py-2 mt-3 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" /> Start First Session
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-white sticky top-0 z-10 shadow-sm">
              <tr className="border-b border-slate-200">
                <th className="py-3 pl-5 pr-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                <th className="py-3 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Project</th>
                <th className="py-3 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden md:table-cell">Provider</th>
                <th className="py-3 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden sm:table-cell">Agents</th>
                <th className="py-3 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden lg:table-cell">Est. Cost</th>
                <th className="py-3 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden sm:table-cell">Date</th>
                <th className="py-3 pl-3 pr-5"></th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {filtered.map((session) => (
                <SessionTableRow
                  key={session.id}
                  session={session}
                  isExpanded={expandedId === session.id}
                  onToggle={() => setExpandedId(prev => prev === session.id ? null : session.id)}
                  onOpenWorkspace={handleOpenWorkspace}
                  onRestoreSession={handleRestoreSession}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
