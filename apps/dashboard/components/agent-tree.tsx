"use client";

import { useMemo } from "react";
import {
  Brain,
  Code2,
  Database,
  Globe,
  FlaskConical,
  Server,
  FileText,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentNode, AgentStatus } from "@/lib/engine-client";

// ─── Role Config ──────────────────────────────────────────────────────────────
const ROLE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  manager:            { icon: Brain,       color: "from-violet-500 to-purple-600",  label: "Manager" },
  database_architect: { icon: Database,    color: "from-blue-500 to-cyan-500",      label: "DB Architect" },
  backend_dev:        { icon: Server,      color: "from-emerald-500 to-teal-500",   label: "Backend Dev" },
  frontend_dev:       { icon: Globe,       color: "from-orange-400 to-amber-500",   label: "Frontend Dev" },
  qa_engineer:        { icon: FlaskConical,color: "from-pink-500 to-rose-500",      label: "QA Engineer" },
  devops_engineer:    { icon: Code2,       color: "from-slate-400 to-slate-500",    label: "DevOps" },
  tech_writer:        { icon: FileText,    color: "from-yellow-400 to-amber-400",   label: "Tech Writer" },
};

const DEFAULT_ROLE = { icon: User, color: "from-slate-500 to-slate-600", label: "Worker" };

// ─── Status Config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<AgentStatus, { icon: React.ElementType; color: string; label: string; animate?: boolean }> = {
  idle:      { icon: Clock,        color: "text-slate-500",   label: "Idle" },
  thinking:  { icon: Loader2,      color: "text-violet-400",  label: "Thinking...", animate: true },
  working:   { icon: Zap,         color: "text-amber-600",   label: "Working",    animate: true },
  fixing:    { icon: Zap,         color: "text-orange-400",  label: "Fixing",     animate: true },
  completed: { icon: CheckCircle2, color: "text-emerald-600", label: "Done" },
  error:     { icon: XCircle,      color: "text-red-600",     label: "Error" },
};

// ─── Single Agent Card ────────────────────────────────────────────────────────
function AgentCard({ node, depth = 0 }: { node: AgentNode; depth?: number }) {
  const role = ROLE_CONFIG[node.role] ?? DEFAULT_ROLE;
  const RoleIcon = role.icon;
  const status = STATUS_CONFIG[node.status] ?? STATUS_CONFIG.idle;
  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2",
        depth > 0 && "pl-6 border-l border-dashed border-slate-200/70"
      )}
    >
      <div
        className={cn(
          "group flex items-start gap-3 p-3 rounded-xl border transition-all duration-300",
          "bg-slate-50 hover:bg-slate-100",
          node.status === "working"   && "border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
          node.status === "thinking"  && "border-violet-500/40 shadow-[0_0_12px_rgba(139,92,246,0.15)]",
          node.status === "completed" && "border-emerald-500/30",
          node.status === "error"     && "border-red-500/30",
          node.status === "idle"      && "border-slate-200",
        )}
      >
        {/* Role icon */}
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br",
            role.color
          )}
        >
          <RoleIcon className="w-4 h-4 text-white" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              {role.label}
            </span>
            <span className="text-[10px] font-mono text-slate-600 truncate">
              #{node.id.slice(0, 6)}
            </span>
          </div>

          {/* Status badge */}
          <div className={cn("flex items-center gap-1 mb-1.5", status.color)}>
            <StatusIcon
              className={cn("w-3 h-3", status.animate && "animate-spin")}
            />
            <span className="text-[11px] font-medium">{status.label}</span>
          </div>

          {/* Task preview */}
          {node.specialized_task && (
            <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
              {node.specialized_task}
            </p>
          )}
        </div>
      </div>

      {/* Connector dot */}
      {depth > 0 && (
        <div className="absolute left-0 top-4 w-3 h-3 rounded-full border-2 border-slate-200 bg-white -translate-x-[7px]" />
      )}
    </div>
  );
}

// ─── Recursive Tree Renderer ──────────────────────────────────────────────────
function AgentTreeNode({
  nodeId,
  agentMap,
  depth = 0,
}: {
  nodeId: string;
  agentMap: Map<string, AgentNode>;
  depth?: number;
}) {
  const node = agentMap.get(nodeId);
  if (!node) return null;

  return (
    <div className="flex flex-col gap-2">
      <AgentCard node={node} depth={depth} />
      {node.children.length > 0 && (
        <div className={cn("flex flex-col gap-2", depth > 0 ? "pl-4" : "pl-6")}>
          {node.children.map((childId) => (
            <AgentTreeNode
              key={childId}
              nodeId={childId}
              agentMap={agentMap}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface AgentTreeProps {
  agents: AgentNode[];
  className?: string;
}

export function AgentTree({ agents, className }: AgentTreeProps) {
  const { agentMap, roots } = useMemo(() => {
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    // Root = nodes with no parent, OR parent not in our agent list
    const childIds = new Set(agents.flatMap((a) => a.children));
    const roots = agents
      .filter((a) => !a.parent_id || !agentMap.has(a.parent_id))
      .map((a) => a.id);
    return { agentMap, roots, childIds };
  }, [agents]);

  if (agents.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-32 text-slate-600 text-sm", className)}>
        <div className="text-center">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No agents spawned yet</p>
        </div>
      </div>
    );
  }

  // Stats
  const stats = {
    total: agents.length,
    working: agents.filter((a) => a.status === "working" || a.status === "thinking").length,
    done: agents.filter((a) => a.status === "completed").length,
    error: agents.filter((a) => a.status === "error").length,
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Stats row */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-xs text-slate-500">{stats.total} agents</span>
        </div>
        {stats.working > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs text-amber-600">{stats.working} active</span>
          </div>
        )}
        {stats.done > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-600">{stats.done} done</span>
          </div>
        )}
        {stats.error > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-red-600">{stats.error} failed</span>
          </div>
        )}
      </div>

      {/* Tree */}
      <div className="flex flex-col gap-3">
        {roots.map((rootId) => (
          <AgentTreeNode key={rootId} nodeId={rootId} agentMap={agentMap} depth={0} />
        ))}
      </div>
    </div>
  );
}
