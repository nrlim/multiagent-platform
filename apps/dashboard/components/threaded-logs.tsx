"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { Loader2, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SessionLog, AgentNode } from "@/lib/engine-client";

// ─── Log level styles ─────────────────────────────────────────────────────────
const LOG_STYLES: Record<string, { color: string; prefix: string }> = {
  info:    { color: "text-slate-300",   prefix: "›" },
  success: { color: "text-emerald-400", prefix: "✓" },
  warning: { color: "text-amber-400",   prefix: "⚠" },
  error:   { color: "text-red-400",     prefix: "✗" },
  command: { color: "text-cyan-400",    prefix: "$" },
  file:    { color: "text-violet-400",  prefix: "⊕" },
};

// ─── Role color pills ─────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  manager:            "bg-violet-500/20 text-violet-300 border-violet-500/30",
  database_architect: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  backend_dev:        "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  frontend_dev:       "bg-amber-500/20 text-amber-300 border-amber-500/30",
  qa_engineer:        "bg-pink-500/20 text-pink-300 border-pink-500/30",
  devops_engineer:    "bg-slate-500/20 text-slate-300 border-slate-500/30",
  tech_writer:        "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  system:             "bg-blue-500/20 text-blue-300 border-blue-500/30",
  root:               "bg-slate-500/20 text-slate-300 border-slate-400/30",
};

function getAgentColor(agentId: string, agents: AgentNode[]): string {
  const node = agents.find((a) => a.id === agentId);
  if (node) return AGENT_COLORS[node.role] ?? "bg-slate-700/40 text-slate-400 border-slate-600/30";
  if (agentId === "system") return AGENT_COLORS["system"];
  return "bg-slate-700/40 text-slate-400 border-slate-600/30";
}

function getAgentLabel(agentId: string, agents: AgentNode[]): string {
  if (agentId === "system") return "SYSTEM";
  if (agentId === "root") return "AGENT";
  const node = agents.find((a) => a.id === agentId);
  if (node) return node.role.replace(/_/g, " ").toUpperCase();
  return agentId.slice(0, 6).toUpperCase();
}

// ─── Threaded Log Entry ───────────────────────────────────────────────────────
function LogEntry({ log, agents }: { log: SessionLog; agents: AgentNode[] }) {
  const style = LOG_STYLES[log.level] ?? LOG_STYLES.info;
  const agentColor = getAgentColor(log.agentId, agents);
  const agentLabel = getAgentLabel(log.agentId, agents);

  return (
    <div className="flex gap-2 group hover:bg-slate-800/30 rounded px-1 py-0.5 transition-colors">
      {/* Timestamp */}
      <span className="text-slate-600 text-xs pt-0.5 select-none shrink-0 w-14 truncate">
        {new Date(log.timestamp).toLocaleTimeString("en", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>

      {/* Agent badge */}
      <span
        className={cn(
          "shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border self-start mt-0.5 tracking-wide",
          agentColor
        )}
      >
        {agentLabel}
      </span>

      {/* Level prefix */}
      <span className={cn("shrink-0 w-3 pt-0.5", style.color)}>{style.prefix}</span>

      {/* Message */}
      <span className={cn("break-all leading-relaxed text-xs", style.color)}>{log.message}</span>
    </div>
  );
}

// ─── Grouped Thread ───────────────────────────────────────────────────────────
function AgentThread({
  agentId,
  logs,
  agents,
  isExpanded,
  onToggle,
}: {
  agentId: string;
  logs: SessionLog[];
  agents: AgentNode[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const agentColor = getAgentColor(agentId, agents);
  const agentLabel = getAgentLabel(agentId, agents);
  const lastLog = logs[logs.length - 1];

  return (
    <div className="border border-slate-800/60 rounded-lg overflow-hidden">
      {/* Thread header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-left"
      >
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border tracking-wide", agentColor)}>
          {agentLabel}
        </span>
        <span className="text-xs text-slate-500 font-mono truncate flex-1">
          {lastLog?.message?.slice(0, 60) ?? "…"}
        </span>
        <Badge variant="outline" className="text-[10px] h-4 px-1 border-slate-700 text-slate-500 shrink-0">
          {logs.length}
        </Badge>
        <span className="text-slate-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
      </button>

      {/* Thread body */}
      {isExpanded && (
        <div className="p-2 font-mono text-xs space-y-0.5 bg-slate-950/40 border-t border-slate-800/60">
          {logs.map((log) => (
            <LogEntry key={log.id} log={log} agents={agents} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface ThreadedLogsProps {
  logs: SessionLog[];
  agents: AgentNode[];
  isRunning?: boolean;
  className?: string;
}

export function ThreadedLogs({ logs, agents, isRunning, className }: ThreadedLogsProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<string>("all");
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set(["system"]));
  const [viewMode, setViewMode] = useState<"flat" | "threaded">("flat");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Group logs by agent
  const grouped = useMemo(() => {
    const map = new Map<string, SessionLog[]>();
    for (const log of logs) {
      const key = log.agentId || "system";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return map;
  }, [logs]);

  // Filtered flat logs
  const filteredLogs = useMemo(() => {
    if (filter === "all") return logs;
    return logs.filter((l) => l.agentId === filter);
  }, [logs, filter]);

  // All unique agent IDs in logs
  const agentIds = useMemo(() => Array.from(grouped.keys()), [grouped]);

  function toggleThread(id: string) {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-700/50">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-amber-500/80" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-xs text-slate-500 font-mono ml-2">hive-output</span>

        {/* View toggle */}
        <div className="flex items-center gap-1 ml-4 bg-slate-800 rounded-md p-0.5">
          <button
            onClick={() => setViewMode("flat")}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded transition-colors",
              viewMode === "flat" ? "bg-slate-700 text-slate-200" : "text-slate-500 hover:text-slate-300"
            )}
          >
            Flat
          </button>
          <button
            onClick={() => setViewMode("threaded")}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded transition-colors",
              viewMode === "threaded" ? "bg-slate-700 text-slate-200" : "text-slate-500 hover:text-slate-300"
            )}
          >
            Threaded
          </button>
        </div>

        {/* Agent filter (flat mode) */}
        {viewMode === "flat" && agentIds.length > 1 && (
          <div className="flex items-center gap-1.5 ml-4 overflow-x-auto">
            <Filter className="w-3 h-3 text-slate-600 shrink-0" />
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border shrink-0 transition-colors",
                filter === "all"
                  ? "border-blue-500/60 text-blue-400 bg-blue-500/10"
                  : "border-slate-700 text-slate-500 hover:border-slate-600"
              )}
            >
              All
            </button>
            {agentIds.map((id) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded border shrink-0 tracking-wide font-bold transition-colors",
                  filter === id
                    ? cn(getAgentColor(id, agents), "opacity-100")
                    : "border-slate-700 text-slate-600 hover:border-slate-600"
                )}
              >
                {getAgentLabel(id, agents)}
              </button>
            ))}
          </div>
        )}

        {isRunning && (
          <Badge
            variant="outline"
            className="ml-auto text-xs border-emerald-500/50 text-emerald-400 animate-pulse shrink-0"
          >
            ● LIVE
          </Badge>
        )}
        {!isRunning && logs.length > 0 && (
          <span className="ml-auto text-xs text-slate-500 font-mono">{logs.length} lines</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-slate-950">
        <div className="p-3 font-mono text-xs min-h-[200px]">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-600">
              Waiting for agent output...
            </div>
          ) : viewMode === "flat" ? (
            <div className="space-y-0.5">
              {filteredLogs.map((log) => (
                <LogEntry key={log.id} log={log} agents={agents} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {agentIds.map((id) => (
                <AgentThread
                  key={id}
                  agentId={id}
                  logs={grouped.get(id) ?? []}
                  agents={agents}
                  isExpanded={expandedThreads.has(id)}
                  onToggle={() => toggleThread(id)}
                />
              ))}
            </div>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 px-1 mt-2 mb-2 text-slate-500 min-h-[24px]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
              <span className="text-xs italic text-slate-400">Hive is working...</span>
              <span className="text-emerald-400 animate-pulse">█</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
