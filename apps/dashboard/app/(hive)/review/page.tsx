"use client";

/**
 * AgentHive v2 — Audit Lab (Quality Gate & Design Spec)
 * Split-view: Design Specs left, Code Reviews right.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Palette, FileText, RefreshCw,
  CheckCircle2, XCircle, AlertTriangle, Clock,
  ChevronDown, ChevronUp, Sparkles, Code2,
  GitBranch, Eye, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import {
  getHiveReviewLogs, getHiveDesignSpecs,
  type ReviewLog, type DesignSpec,
} from "@/lib/engine-client";

// ─── Verdict Badge ────────────────────────────────────────────────────────────
function VerdictBadge({ verdict }: { verdict: ReviewLog["verdict"] }) {
  const ok = verdict === "APPROVED";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border",
      ok ? "bg-emerald-50 border-emerald-200 text-emerald-700"
         : "bg-red-50 border-red-200 text-red-700"
    )}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {ok ? "Approved" : "Refactor"}
    </span>
  );
}

// ─── Review Card ──────────────────────────────────────────────────────────────
function ReviewCard({ log }: { log: ReviewLog }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={cn(
      "rounded-lg border p-3.5 transition-colors duration-150 bg-white shadow-sm",
      log.verdict === "APPROVED"
        ? "border-emerald-200 hover:border-emerald-300"
        : "border-red-200 hover:border-red-300"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <VerdictBadge verdict={log.verdict} />
            <span className="text-[10px] font-mono text-slate-600 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
              {log.worker_role.replace(/_/g, " ")}
            </span>
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />{time}
            </span>
          </div>
          <p className="text-xs font-medium text-slate-800 leading-snug">{log.task_title}</p>
          {/* Severity row */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {log.critical_count > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">
                {log.critical_count} critical
              </span>
            )}
            {log.major_count > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                {log.major_count} major
              </span>
            )}
            {log.minor_count > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">
                {log.minor_count} minor
              </span>
            )}
            {log.critical_count === 0 && log.major_count === 0 && log.minor_count === 0 && (
              <span className="text-[10px] text-emerald-600 font-medium">✓ No issues</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 pt-2.5 border-t border-slate-100">
              {log.summary ? (
                <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{log.summary}</p>
              ) : (
                <p className="text-[11px] text-slate-500 italic">No summary provided.</p>
              )}
              {log.report_path && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <FileText className="w-3 h-3" />
                  <span className="font-mono">{log.report_path}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Design Spec Card ─────────────────────────────────────────────────────────
function DesignSpecCard({ spec }: { spec: DesignSpec }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(spec.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-lg border border-violet-200 bg-white shadow-sm hover:border-violet-300 p-3.5 transition-colors duration-150">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-violet-50 border-violet-200 text-violet-700">
              <Sparkles className="w-3 h-3" /> Design Spec
            </span>
            {spec.color_primary && (
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span
                  className="w-2.5 h-2.5 rounded-full border border-slate-300 shrink-0 shadow-sm"
                  style={{ backgroundColor: spec.color_primary }}
                />
                {spec.color_primary}
              </span>
            )}
            {spec.font && (
              <span className="text-[10px] text-slate-500 font-mono">{spec.font}</span>
            )}
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />{time}
            </span>
          </div>
          <p className="text-xs font-medium text-slate-800 leading-snug">{spec.task_title}</p>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5">
              {spec.summary && (
                <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{spec.summary}</p>
              )}
              {spec.spec_path && (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <FileText className="w-3 h-3" />
                  <span className="font-mono">{spec.spec_path}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, title, description }: {
  icon: React.ElementType; title: string; description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 shadow-sm flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700 mb-1">{title}</p>
      <p className="text-xs text-slate-500 max-w-xs leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Architecture Panel ───────────────────────────────────────────────────────
function ArchPanel() {
  const layers = [
    { name: "Entities",    icon: Code2,   color: "border-cyan-200 bg-white",   desc: "Pure domain models. Zero framework dependencies." },
    { name: "Use Cases",   icon: GitBranch, color: "border-indigo-200 bg-white", desc: "Application logic. Orchestrates entities." },
    { name: "Controllers", icon: Layers,  color: "border-violet-200 bg-white", desc: "HTTP/WS handlers. Thin — delegates to Use Cases." },
    { name: "Gateways",    icon: Eye,     color: "border-amber-200 bg-white", desc: "DB adapters, API clients, external integrations." },
  ];
  return (
    <div className="space-y-3">
      {layers.map(l => {
        const LIcon = l.icon;
        return (
          <div key={l.name} className={cn("rounded-lg shadow-sm border p-3.5 flex items-start gap-3 transition-colors hover:bg-slate-50", l.color)}>
            <LIcon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-slate-800">{l.name}</p>
              <p className="text-[11px] text-slate-600 mt-0.5">{l.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReviewLogsPage() {
  const { hiveId, reviewLogs, designSpecs, setReviewLogs, setDesignSpecs } = useHiveStore();
  const [isLoading, setIsLoading] = useState(false);
  const [rightTab, setRightTab] = useState<"reviews" | "arch">("reviews");

  const refresh = useCallback(async () => {
    if (!hiveId) return;
    setIsLoading(true);
    try {
      const [logs, specs] = await Promise.all([
        getHiveReviewLogs(hiveId),
        getHiveDesignSpecs(hiveId),
      ]);
      if (logs.length)  setReviewLogs(logs);
      if (specs.length) setDesignSpecs(specs);
    } catch { /* engine offline */ }
    finally { setIsLoading(false); }
  }, [hiveId, setReviewLogs, setDesignSpecs]);

  useEffect(() => { refresh(); }, [refresh]);

  const approved  = reviewLogs.filter(l => l.verdict === "APPROVED").length;
  const refactor  = reviewLogs.filter(l => l.verdict === "REFACTOR_REQUIRED").length;
  const criticals = reviewLogs.reduce((s, l) => s + l.critical_count, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-slate-200 flex items-center justify-between px-6 py-3.5 shrink-0 bg-slate-50/50">
        <div>
          <h1 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-600" /> Audit Lab
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Code reviews, design specs, and architecture reference</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Stats strip */}
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="text-emerald-600 font-semibold">{approved} approved</span>
            {refactor > 0 && <span className="text-red-600 font-semibold">{refactor} refactor</span>}
            {criticals > 0 && (
              <span className="flex items-center gap-1 text-red-600 font-semibold">
                <AlertTriangle className="w-3 h-3" />{criticals} critical
              </span>
            )}
            <span className="text-violet-600 font-semibold">{designSpecs.length} specs</span>
          </div>
          <button
            id="btn-refresh-reviews"
            onClick={refresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 hover:bg-white transition-all disabled:opacity-40 shadow-sm bg-white"
          >
            <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      {/* ── Split-view Body ──────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden bg-slate-50/30">

        {/* ── LEFT PANE: Design Specs ──────────────────────────────────── */}
        <div className="w-[48%] shrink-0 border-r border-slate-200 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200 shrink-0 bg-white">
            <Palette className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Design Spec</span>
            {designSpecs.length > 0 && (
              <span className="ml-auto text-[10px] font-mono font-semibold text-slate-400 bg-slate-100 px-1.5 rounded">{designSpecs.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {designSpecs.length === 0 ? (
              <EmptyState
                icon={Palette}
                title="No Design Specs"
                description="UI/UX Research agents publish specs before frontend tasks. They appear here when a frontend task is dispatched."
              />
            ) : (
              designSpecs.map((spec, i) => (
                <motion.div key={`${spec.task_id}-${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <DesignSpecCard spec={spec} />
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT PANE: Code Reviews + Architecture ───────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sub-tabs */}
          <div className="flex items-center gap-1 px-4 h-12 border-b border-slate-200 shrink-0 bg-white">
            {[
              { id: "reviews" as const, label: "Code Reviews", icon: ShieldCheck, count: reviewLogs.length },
              { id: "arch"    as const, label: "Architecture",  icon: GitBranch },
            ].map(tab => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setRightTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-all",
                  rightTab === tab.id
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
                {"count" in tab && tab.count! > 0 && (
                  <span className={cn("text-[10px] font-mono px-1.5 rounded", rightTab === tab.id ? "bg-indigo-100 text-indigo-800" : "bg-slate-200 text-slate-600")}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <AnimatePresence mode="wait">
              {rightTab === "reviews" && (
                <motion.div key="reviews" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                  {reviewLogs.length === 0 ? (
                    <EmptyState
                      icon={ShieldCheck}
                      title="No Reviews Yet"
                      description="Code Reviewer agents publish verdicts here. Every completed task is reviewed automatically."
                    />
                  ) : (
                    reviewLogs.map((log, i) => (
                      <motion.div key={`${log.task_id}-${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                        <ReviewCard log={log} />
                      </motion.div>
                    ))
                  )}
                </motion.div>
              )}
              {rightTab === "arch" && (
                <motion.div key="arch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <ArchPanel />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
