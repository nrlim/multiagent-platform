"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeMouseHandler,
  MarkerType, Position, BackgroundVariant, Handle, Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Server, Globe, Database, FlaskConical, Code2,
  FileText, User, CheckCircle2, XCircle, Zap,
  Layers, LayoutGrid, RefreshCw, Cpu, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDagreLayout, NODE_WIDTH, NODE_HEIGHT } from "@/lib/dagre-layout";
import type { AgentNode, AgentStatus } from "@/lib/engine-client";

// ─── Role config (clean, model-agnostic labels) ──────────────────────────────
const ROLE_CONFIG: Record<string, {
  icon: React.ElementType;
  accentColor: string;
  borderColor: string;   // Tailwind border class
  glowColor: string;     // CSS color for box-shadow
  label: string;
  modelBadge?: string;   // Which model powers this (injected from hive config ideally)
}> = {
  manager:            { icon: Brain,        accentColor: "#6366f1", borderColor: "border-indigo-600/50",   glowColor: "#6366f1", label: "Manager" },
  database_architect: { icon: Database,     accentColor: "#0ea5e9", borderColor: "border-sky-600/50",     glowColor: "#0ea5e9", label: "DB Architect" },
  backend_dev:        { icon: Server,       accentColor: "#10b981", borderColor: "border-emerald-600/50", glowColor: "#10b981", label: "Backend Dev" },
  frontend_dev:       { icon: Globe,        accentColor: "#f59e0b", borderColor: "border-amber-500/50",   glowColor: "#f59e0b", label: "Frontend Dev" },
  qa_engineer:        { icon: FlaskConical, accentColor: "#ec4899", borderColor: "border-pink-600/50",    glowColor: "#ec4899", label: "QA Engineer" },
  devops_engineer:    { icon: Code2,        accentColor: "#64748b", borderColor: "border-slate-500/50",   glowColor: "#64748b", label: "DevOps" },
  tech_writer:        { icon: FileText,     accentColor: "#a78bfa", borderColor: "border-violet-500/50",  glowColor: "#a78bfa", label: "Tech Writer" },
};
const DEFAULT_ROLE = { icon: User, accentColor: "#475569", borderColor: "border-slate-600/40", glowColor: "#475569", label: "Worker" };

// ─── Status config ────────────────────────────────────────────────────────────
type StatusCfg = { dot: string; badge: string; badgeText: string; animate: boolean };
const STATUS_MAP: Record<AgentStatus, StatusCfg> = {
  idle:      { dot: "bg-slate-600",   badge: "bg-slate-900/80 border-slate-700/40 text-slate-400",   badgeText: "Queued",   animate: false },
  thinking:  { dot: "bg-indigo-400",  badge: "bg-indigo-950/80 border-indigo-700/40 text-indigo-300", badgeText: "Active",   animate: true  },
  working:   { dot: "bg-amber-400",   badge: "bg-amber-950/80 border-amber-700/40 text-amber-300",   badgeText: "Working",  animate: true  },
  fixing:    { dot: "bg-orange-400",  badge: "bg-orange-950/80 border-orange-700/40 text-orange-300", badgeText: "Fixing",   animate: true  },
  completed: { dot: "bg-emerald-400", badge: "bg-emerald-950/80 border-emerald-700/40 text-emerald-400", badgeText: "Success", animate: false },
  error:     { dot: "bg-red-400",     badge: "bg-red-950/80 border-red-700/40 text-red-400",         badgeText: "Failed",   animate: false },
};

// ─── Custom React Flow Node ────────────────────────────────────────────────────
interface AgentNodeData extends Record<string, unknown> {
  agent: AgentNode;
  thought?: string;
  toolCall?: string;
  focused?: boolean;
  onFocus?: (id: string) => void;
}

function AgentFlowNode({ data }: { data: AgentNodeData }) {
  const { agent, thought, toolCall, focused, onFocus } = data;
  const role    = ROLE_CONFIG[agent.role] ?? DEFAULT_ROLE;
  const RoleIcon = role.icon;
  const s       = STATUS_MAP[agent.status] ?? STATUS_MAP.idle;
  const isActive = agent.status === "thinking" || agent.status === "working";
  const isDone   = agent.status === "completed";
  const isError  = agent.status === "error";

  // Compose inline box-shadow for glow
  const nodeStyle: React.CSSProperties = {
    boxShadow: isActive
      ? `0 0 0 1px ${role.glowColor}60, 0 8px 24px ${role.glowColor}18`
      : isDone
        ? `0 0 0 1px #10b98150`
        : isError
          ? `0 0 0 1px #ef444460, 0 4px 16px #ef444418`
          : "none",
  };

  return (
    <>
      <Handle type="target" position={Position.Top}
        style={{ width: 8, height: 8, background: "#1e293b", border: "2px solid #334155", borderRadius: "50%" }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 22 }}
        onClick={() => onFocus?.(agent.id)}
        style={nodeStyle}
        className={cn(
          "w-[200px] rounded-xl border cursor-pointer overflow-hidden",
          "bg-slate-950/95 backdrop-blur-xl",
          role.borderColor,
          focused && "ring-1 ring-white/30 scale-[1.03]",
          "transition-transform duration-150"
        )}
      >
        {/* Accent stripe at top */}
        <div
          className="h-0.5 w-full"
          style={{ background: `linear-gradient(90deg, ${role.accentColor}80, transparent)` }}
        />

        {/* Header row */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <RoleIcon className="w-3.5 h-3.5 shrink-0" style={{ color: role.accentColor }} />
            <span className="text-[11px] font-bold tracking-wide uppercase text-slate-300 truncate">
              {role.label}
            </span>
          </div>
          {/* Status badge */}
          <span className={cn(
            "text-[9px] font-bold px-1.5 py-0.5 rounded-md border tracking-wide",
            s.badge
          )}>
            {isActive && s.animate && (
              <motion.span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                style={{ background: role.accentColor }}
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
            {isDone  && <CheckCircle2 className="inline w-2.5 h-2.5 mr-0.5 align-middle" />}
            {isError && <XCircle      className="inline w-2.5 h-2.5 mr-0.5 align-middle" />}
            {s.badgeText}
          </span>
        </div>

        {/* Body */}
        <div className="px-3 py-2 space-y-1.5">
          {/* ID */}
          <span className="text-[9px] font-mono text-slate-600 tracking-wide">
            #{agent.id.slice(0, 8)}
          </span>

          {/* Task */}
          {agent.specialized_task && (
            <p className="text-[11px] text-slate-400 leading-snug line-clamp-2">
              {agent.specialized_task}
            </p>
          )}

          {/* Thought — inline chip */}
          <AnimatePresence>
            {thought && isActive && (
              <motion.div
                key="thought"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-lg bg-slate-900/80 border border-white/5 px-2 py-1.5"
              >
                <div className="flex items-start gap-1">
                  <Brain className="w-2.5 h-2.5 text-indigo-400/70 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-slate-400 italic leading-snug line-clamp-2">
                    {thought}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tool call */}
          <AnimatePresence>
            {toolCall && agent.status === "working" && (
              <motion.div
                key="tool"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-950/40 border border-amber-800/25"
              >
                <Zap className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                <span className="text-[10px] text-amber-400 font-mono truncate">{toolCall}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Progress shimmer at bottom when active */}
        {isActive && (
          <div className="h-px w-full overflow-hidden bg-slate-900">
            <motion.div
              className="h-full"
              style={{ background: `linear-gradient(90deg, transparent, ${role.accentColor}, transparent)` }}
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            />
          </div>
        )}
      </motion.div>

      <Handle type="source" position={Position.Bottom}
        style={{ width: 8, height: 8, background: "#1e293b", border: "2px solid #334155", borderRadius: "50%" }}
      />
    </>
  );
}

const nodeTypes = { agentNode: AgentFlowNode };

// ─── Token / cost monitor widget ─────────────────────────────────────────────
interface TokenStats { tokens: number; cost: number; agentCount: number; doneCount: number; }

function TokenMonitor({ stats }: { stats: TokenStats }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl
        bg-slate-950/90 backdrop-blur-sm border border-slate-800/80 text-xs font-medium shadow-xl"
    >
      <div className="flex items-center gap-1 text-indigo-400">
        <Brain className="w-3 h-3" />
        <span className="font-mono font-bold">{stats.tokens.toLocaleString()}</span>
        <span className="text-slate-600">tok</span>
      </div>
      <div className="w-px h-3 bg-slate-800" />
      <div className="flex items-center gap-1 text-emerald-400">
        <DollarSign className="w-3 h-3" />
        <span className="font-mono font-bold">~{stats.cost.toFixed(4)}</span>
      </div>
      <div className="w-px h-3 bg-slate-800" />
      <div className="flex items-center gap-1 text-slate-400">
        <Cpu className="w-3 h-3" />
        <span className="font-mono">{stats.doneCount}/{stats.agentCount}</span>
      </div>
    </motion.div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface AgentGraphProps {
  agents: AgentNode[];
  thoughts?:  Record<string, string>;
  toolCalls?: Record<string, string>;
  tokenStats?: TokenStats;
  onFocusAgent?: (agentId: string | null) => void;
  className?: string;
}

export function AgentGraph({
  agents,
  thoughts  = {},
  toolCalls = {},
  tokenStats,
  onFocusAgent,
  className,
}: AgentGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"TB" | "LR">("TB");
  const positionCache = useRef<Record<string, { x: number; y: number }>>({});

  const handleFocus = useCallback((id: string) => {
    const next = focusedId === id ? null : id;
    setFocusedId(next);
    onFocusAgent?.(next);
  }, [focusedId, onFocusAgent]);

  useEffect(() => {
    if (agents.length === 0) {
      setNodes([]); setEdges([]); positionCache.current = {};
      return;
    }

    const newIds = agents.map(a => a.id).filter(id => !positionCache.current[id]);
    if (newIds.length > 0) {
      const fresh = computeDagreLayout(agents, direction);
      for (const id of newIds) {
        if (fresh[id]) positionCache.current[id] = fresh[id];
      }
    }

    const newNodes: Node[] = agents.map(agent => ({
      id:   agent.id,
      type: "agentNode",
      position: positionCache.current[agent.id] ?? { x: 0, y: 0 },
      data: {
        agent,
        thought:  thoughts[agent.id],
        toolCall: toolCalls[agent.id],
        focused:  focusedId === agent.id,
        onFocus:  handleFocus,
      } as AgentNodeData,
      draggable: true,
      width:  NODE_WIDTH,
      height: NODE_HEIGHT,
    }));

    const newEdges: Edge[] = agents
      .filter(a => a.parent_id)
      .map(a => {
        const isActive = a.status === "working" || a.status === "thinking";
        const color =
          a.status === "working"   ? "#f59e0b" :
          a.status === "thinking"  ? "#6366f1" :
          a.status === "completed" ? "#10b981" :
          a.status === "error"     ? "#ef4444" : "#1e293b";
        return {
          id:       `e-${a.parent_id}-${a.id}`,
          source:    a.parent_id!,
          target:    a.id,
          animated:  isActive,
          style:    { stroke: color, strokeWidth: isActive ? 2 : 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
        };
      });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [agents, thoughts, toolCalls, focusedId, direction, handleFocus, setNodes, setEdges]);

  const onNodeDragStop: NodeMouseHandler = useCallback((_e, node) => {
    positionCache.current[node.id] = node.position;
  }, []);

  const relayout = useCallback(() => {
    positionCache.current = {};
    const fresh = computeDagreLayout(agents, direction);
    Object.assign(positionCache.current, fresh);
    setNodes(nds => nds.map(n => ({ ...n, position: positionCache.current[n.id] ?? n.position })));
  }, [agents, direction, setNodes]);

  // Empty state
  if (agents.length === 0) {
    return (
      <div className={cn("flex flex-col h-full min-h-0", className)}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-700">
          <motion.div
            animate={{ opacity: [0.2, 0.5, 0.2], scale: [0.96, 1.04, 0.96] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="w-14 h-14 rounded-2xl bg-indigo-950/20 border border-indigo-900/30 flex items-center justify-center"
          >
            <Brain className="w-7 h-7 text-indigo-700/60" />
          </motion.div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-slate-600">Agent Network</p>
            <p className="text-xs text-slate-700">Launch a Hive session to see the live graph</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-full w-full flex flex-col", className)}>
      <div className="flex-1 min-h-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeDragStop={onNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          minZoom={0.15}
          maxZoom={2}
        >
          {/* Subtle dot grid */}
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#1e293b" />

          {/* Controls — styled dark */}
          <Controls
            className="!bg-slate-950/90 !border-slate-800/80 !shadow-2xl backdrop-blur-sm"
            showInteractive={false}
          />

          {/* MiniMap */}
          <MiniMap
            className="!bg-slate-950/90 !border-slate-800/60"
            nodeColor={(n) => {
              const role = (n.data as unknown as AgentNodeData).agent?.role ?? "";
              return ROLE_CONFIG[role]?.accentColor ?? "#475569";
            }}
            maskColor="rgba(2, 6, 23, 0.78)"
            nodeStrokeWidth={2}
          />

          {/* Top-right: token stats + layout controls */}
          <Panel position="top-right" className="flex items-center gap-2">
            {tokenStats && <TokenMonitor stats={tokenStats} />}
            <div className="flex items-center gap-0.5 p-1 rounded-xl bg-slate-950/90 backdrop-blur-sm border border-slate-800/80 shadow-xl">
              <button
                onClick={() => setDirection("TB")}
                title="Vertical layout"
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  direction === "TB" ? "bg-indigo-600/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDirection("LR")}
                title="Horizontal layout"
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  direction === "LR" ? "bg-indigo-600/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-slate-800 mx-0.5" />
              <button
                onClick={relayout}
                title="Auto-arrange"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </Panel>

          {/* Clear focus indicator */}
          {focusedId && (
            <Panel position="top-left">
              <motion.button
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => { setFocusedId(null); onFocusAgent?.(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                  bg-slate-950/90 border border-slate-800/80 text-slate-400
                  text-xs font-semibold hover:text-slate-200 transition-colors shadow-xl"
              >
                <XCircle className="w-3 h-3" /> Clear focus
              </motion.button>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}
