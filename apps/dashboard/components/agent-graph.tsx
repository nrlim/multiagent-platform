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
  FileText, User, CheckCircle2, XCircle, Zap, Palette, ShieldCheck, LineChart,
  Layers, LayoutGrid, RefreshCw, Cpu, DollarSign, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDagreLayout, NODE_WIDTH, NODE_HEIGHT } from "@/lib/dagre-layout";
import type { AgentNode, AgentStatus } from "@/lib/engine-client";

// ─── Role config ──────────────────────────────────────────────────────────────
type RoleCfg = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accentColor: string;
  borderColor: string;
  glowColor: string;
  label: string;
};
const ROLE_CONFIG: Record<string, RoleCfg> = {
  manager: { icon: Brain, accentColor: "#6366f1", borderColor: "border-indigo-600/50", glowColor: "#6366f1", label: "Project Manager" },
  business_analyst: { icon: LineChart, accentColor: "#14b8a6", borderColor: "border-teal-500/50", glowColor: "#14b8a6", label: "Business Analyst" },
  database_architect: { icon: Database, accentColor: "#0ea5e9", borderColor: "border-sky-600/50", glowColor: "#0ea5e9", label: "DB Architect" },
  backend_dev: { icon: Server, accentColor: "#10b981", borderColor: "border-emerald-600/50", glowColor: "#10b981", label: "Backend Engineer" },
  frontend_dev: { icon: Globe, accentColor: "#f59e0b", borderColor: "border-amber-500/50", glowColor: "#f59e0b", label: "Frontend Engineer" },
  uiux_researcher: { icon: Palette, accentColor: "#a855f7", borderColor: "border-purple-500/50", glowColor: "#a855f7", label: "Design Researcher" },
  code_reviewer: { icon: ShieldCheck, accentColor: "#3b82f6", borderColor: "border-blue-500/50", glowColor: "#3b82f6", label: "Code Reviewer" },
  qa_engineer: { icon: FlaskConical, accentColor: "#ec4899", borderColor: "border-pink-600/50", glowColor: "#ec4899", label: "QA Engineer" },
  devops_engineer: { icon: Code2, accentColor: "#64748b", borderColor: "border-slate-500/50", glowColor: "#64748b", label: "DevOps" },
  tech_writer: { icon: FileText, accentColor: "#a78bfa", borderColor: "border-violet-500/50", glowColor: "#a78bfa", label: "Tech Writer" },
  // ── Swarm Routine roles ───────────────────────────────────────────────────
  swarm_dispatcher: { icon: Brain, accentColor: "#818cf8", borderColor: "border-indigo-500/50", glowColor: "#818cf8", label: "Project Manager" },
  uiux_scout: { icon: Palette, accentColor: "#c084fc", borderColor: "border-purple-400/50", glowColor: "#c084fc", label: "UX Designer" },
  logic_weaver: { icon: Server, accentColor: "#34d399", borderColor: "border-emerald-400/50", glowColor: "#34d399", label: "Backend Engineer" },
  pixel_crafter: { icon: Globe, accentColor: "#fbbf24", borderColor: "border-amber-400/50", glowColor: "#fbbf24", label: "Frontend Engineer" },
  guardian: { icon: ShieldCheck, accentColor: "#f472b6", borderColor: "border-pink-400/50", glowColor: "#f472b6", label: "QA Lead" },
};

/** Resolve a RoleCfg — always use the real role name for unknown roles, never "Worker" */
function getRoleCfg(role: string): RoleCfg {
  if (ROLE_CONFIG[role]) return ROLE_CONFIG[role];
  // Humanise snake_case: "some_role" → "Some Role"
  const label = role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { icon: User, accentColor: "#475569", borderColor: "border-slate-600/40", glowColor: "#475569", label };
}

// ─── Agent name generator ─────────────────────────────────────────────────────
// Generates a deterministic, realistic name from agent ID + role.
const AGENT_NAMES: Record<string, string[]> = {
  manager: ["Alex", "Jordan", "Sam", "Riley", "Morgan"],
  business_analyst: ["Priya", "Chris", "Dana", "Robin", "Casey"],
  database_architect: ["Zara", "Leo", "Mia", "Ivan", "Nadia"],
  backend_dev: ["Kai", "Ethan", "Lena", "Omar", "Sasha"],
  frontend_dev: ["Luna", "Noah", "Aria", "Finn", "Zoe"],
  uiux_researcher: ["Maya", "Cleo", "Theo", "Isla", "Ravi"],
  code_reviewer: ["Marcus", "Yuki", "Aiden", "Vera", "Tobias"],
  qa_engineer: ["Rex", "Amara", "Eli", "Sage", "Jin"],
  devops_engineer: ["Axel", "Nora", "Cyrus", "Demi", "Felix"],
  tech_writer: ["Quinn", "Erin", "Hana", "Beau", "Tara"],
  swarm_dispatcher: ["Orion", "Lyra", "Atlas", "Nova", "Zephyr"],
  uiux_scout: ["Iris", "Ciel", "Muse", "Aurora", "Pixel"],
  logic_weaver: ["Forge", "Nexus", "Cipher", "Arc", "Byte"],
  pixel_crafter: ["Blaze", "Flux", "Prism", "Wave", "Glow"],
  guardian: ["Shield", "Bastion", "Aegis", "Vance", "Sentinel"],
};

function getAgentName(agentId: string, role: string): string {
  const pool = AGENT_NAMES[role] ?? ["Agent"];
  // Seeded by last 4 chars of id for determinism
  const seed = parseInt(agentId.replace(/-/g, "").slice(-4), 16);
  return pool[seed % pool.length];
}


// ─── Status config ────────────────────────────────────────────────────────────
type StatusCfg = { dot: string; badge: string; badgeText: string; animate: boolean };
const STATUS_MAP: Record<AgentStatus, StatusCfg> = {
  idle: { dot: "bg-slate-300", badge: "bg-slate-50 border-slate-200 text-slate-500", badgeText: "Queued", animate: false },
  thinking: { dot: "bg-indigo-400", badge: "bg-indigo-50 border-indigo-200 text-indigo-700", badgeText: "Active", animate: true },
  working: { dot: "bg-emerald-400", badge: "bg-amber-50 border-amber-200 text-amber-700", badgeText: "Working", animate: true },
  fixing: { dot: "bg-rose-400", badge: "bg-rose-50 border-rose-200 text-rose-700", badgeText: "Fixing", animate: true },
  completed: { dot: "bg-emerald-400", badge: "bg-emerald-50 border-emerald-200 text-emerald-700", badgeText: "Done", animate: false },
  error: { dot: "bg-red-400", badge: "bg-red-50 border-red-200 text-red-700", badgeText: "Error", animate: false },
};

// ─── Custom React Flow Node ────────────────────────────────────────────────────
interface AgentNodeData extends Record<string, unknown> {
  agent: AgentNode;
  agentName: string;
  thought?: string;
  toolCall?: string;
  focused?: boolean;
  isPreparing?: boolean;
  isNewlySpawned?: boolean;
  activeTaskTitle?: string;
  isManagerPulsing?: boolean;
  agentProgress?: number;      // 0-100, undefined = indeterminate
  onFocus?: (id: string) => void;
}

// Shimmer "preparing to spawn" placeholder
function PrepareShimmer({ role }: { role: RoleCfg }) {
  return (
    <div
      className={cn(
        "w-[200px] rounded-md border overflow-hidden bg-white shadow-sm",
        role.borderColor
      )}
    >
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${role.accentColor}40, transparent)` }} />
      <div className="px-3 py-2.5 space-y-2">
        {/* Animated shimmer lines */}
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full bg-slate-100 relative overflow-hidden">
            <motion.div
              className="absolute inset-0"
              style={{ background: `linear-gradient(90deg, transparent, ${role.accentColor}30, transparent)` }}
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
            />
          </div>
          <div className="h-2.5 w-20 rounded-full bg-slate-100 relative overflow-hidden">
            <motion.div
              className="absolute inset-0"
              style={{ background: `linear-gradient(90deg, transparent, ${role.accentColor}30, transparent)` }}
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "linear", delay: 0.1 }}
            />
          </div>
        </div>
        <div className="h-2 w-32 rounded-full bg-slate-100 relative overflow-hidden">
          <motion.div
            className="absolute inset-0"
            style={{ background: `linear-gradient(90deg, transparent, ${role.accentColor}20, transparent)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay: 0.2 }}
          />
        </div>
        <div className="h-2 w-24 rounded-full bg-slate-100 relative overflow-hidden">
          <motion.div
            className="absolute inset-0"
            style={{ background: `linear-gradient(90deg, transparent, ${role.accentColor}15, transparent)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear", delay: 0.3 }}
          />
        </div>
        <div className="flex justify-center pt-1">
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="text-[9px] font-semibold tracking-widest uppercase"
            style={{ color: role.accentColor + "80" }}
          >
            Preparing…
          </motion.span>
        </div>
      </div>
    </div>
  );
}

function AgentFlowNode({ data }: { data: AgentNodeData }) {
  const {
    agent, agentName, thought, toolCall, focused, onFocus,
    isPreparing, isNewlySpawned, activeTaskTitle, isManagerPulsing, agentProgress,
  } = data;
  
  const [simProgress, setSimProgress] = useState(0);
  const role = getRoleCfg(agent.role);
  const RoleIcon = role.icon;
  const s = STATUS_MAP[agent.status] ?? STATUS_MAP.idle;
  const isActive = agent.status === "thinking" || agent.status === "working";
  const isDone = agent.status === "completed";
  const isError = agent.status === "error";
  const isManager = agent.role === "manager" || agent.role === "swarm_dispatcher";

  useEffect(() => {
    if (!isActive) {
      if (isDone) setSimProgress(100);
      return;
    }
    const interval = setInterval(() => {
      setSimProgress((prev) => {
        const step = prev < 30 ? 6 : prev < 60 ? 3 : prev < 85 ? 1 : 0.2;
        const next = prev + step;
        return next >= 98 ? 98 : next;
      });
    }, 600);
    return () => clearInterval(interval);
  }, [isActive, isDone]);

  const displayProgress = agentProgress !== undefined ? agentProgress : Math.floor(simProgress);

  // Status-driven border color: Green=active/done, Grey=idle, Red=error
  const borderColor = isError ? "#ef4444"
    : isDone ? "#10b981"
      : isActive ? "#10b981"
        : "#e2e8f0";
  const nodeStyle: React.CSSProperties = {
    borderColor,
    boxShadow: isManagerPulsing && isManager
      ? `0 0 0 1px ${role.glowColor}60`
      : isActive
        ? `0 0 0 1px ${borderColor}40`
        : isDone
          ? `0 0 0 1px ${borderColor}30`
          : "none",
  };

  if (isPreparing) {
    return (
      <>
        <Handle type="target" position={Position.Top}
          style={{ width: 6, height: 6, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "2px" }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.6, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <PrepareShimmer role={role} />
        </motion.div>
        <Handle type="source" position={Position.Bottom}
          style={{ width: 6, height: 6, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "2px" }}
        />
      </>
    );
  }

  return (
    <>
      <Handle type="target" position={Position.Top}
        style={{ width: 6, height: 6, background: "#ffffff", border: `1px solid ${borderColor}`, borderRadius: "2px" }}
      />

      {/* Manager pulse ring */}
      <AnimatePresence>
        {isManager && isManagerPulsing && (
          <motion.div
            key="manager-pulse"
            className="absolute inset-0 rounded-sm pointer-events-none"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: [0, 0.6, 0], scale: [1, 1.1, 1.18] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ border: `1px solid ${role.glowColor}`, zIndex: 1 }}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={isNewlySpawned ? { opacity: 0, scale: 0.82, y: -8 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={() => onFocus?.(agent.id)}
        style={nodeStyle}
        className={cn(
          "w-[200px] rounded-md border cursor-pointer overflow-hidden relative shadow-sm",
          "bg-white",
          focused && "ring-2 ring-indigo-500/30 scale-[1.02]",
          "transition-transform duration-150"
        )}
      >
        {/* Accent stripe at top — role color */}
        <div
          className="h-[2px] w-full"
          style={{ background: role.accentColor }}
        />

        {/* Header row */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <RoleIcon className="w-3 h-3 shrink-0" style={{ color: role.accentColor }} />
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-bold text-slate-800 truncate">{agentName}</span>
              <span className="text-[9px] font-semibold tracking-widest uppercase truncate" style={{ color: role.accentColor }}>
                {role.label}
              </span>
            </div>
          </div>
          {/* Status badge */}
          <span className={cn(
            "text-[9px] font-bold px-1.5 py-0.5 rounded-md border tracking-wide shrink-0",
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
            {isDone && <CheckCircle2 className="inline w-2.5 h-2.5 mr-0.5 align-middle" />}
            {isError && <XCircle className="inline w-2.5 h-2.5 mr-0.5 align-middle" />}
            {s.badgeText}
          </span>
        </div>

        {/* Body */}
        <div className="px-3 py-2 space-y-2">
          <span className="text-[9px] font-mono text-slate-400 tracking-wide">
            #{agent.id.slice(0, 6)}
          </span>

          {/* Active task badge (from bucket) */}
          <AnimatePresence>
            {activeTaskTitle && isActive && (
              <motion.div
                key="active-task"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-slate-50 border border-slate-200"
              >
                <Sparkles className="w-2.5 h-2.5 text-indigo-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-700 leading-snug line-clamp-2 font-medium">
                  {activeTaskTitle}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Fallback: specialized task */}
          {!activeTaskTitle && agent.specialized_task && (
            <p className="text-[11px] text-slate-600 leading-snug line-clamp-2">
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
                className="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-1.5"
              >
                <div className="flex items-start gap-1.5">
                  <Brain className="w-2.5 h-2.5 text-indigo-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-indigo-700 italic leading-snug line-clamp-2">
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
                className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-amber-50 border border-amber-200"
              >
                <Zap className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                <span className="text-[10px] text-amber-700 font-mono truncate">{toolCall}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Progress bar — shows numeric percentage */}
        {isActive && (
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-slate-400 font-medium">Progress</span>
              <motion.span
                key={displayProgress}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-[9px] font-bold font-mono"
                style={{ color: role.accentColor }}
              >
                {displayProgress}%
              </motion.span>
            </div>
            <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: role.accentColor }}
                animate={{ width: `${displayProgress}%` }}
                transition={{ type: "spring", stiffness: 60 }}
              />
            </div>
          </div>
        )}
        {isDone && (
          <div className="px-3 pb-2">
            <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: `${role.accentColor}30` }}>
              <div className="h-full rounded-full w-full" style={{ background: role.accentColor }} />
            </div>
          </div>
        )}
      </motion.div>

      <Handle type="source" position={Position.Bottom}
        style={{ width: 6, height: 6, background: "#ffffff", border: `1px solid ${borderColor}`, borderRadius: "2px" }}
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
        bg-slate-50/90 backdrop-blur-sm border border-slate-200/80 text-xs font-medium shadow-xl"
    >
      <div className="flex items-center gap-1 text-indigo-600">
        <Brain className="w-3 h-3" />
        <span className="font-mono font-bold">{stats.tokens.toLocaleString()}</span>
        <span className="text-slate-600">tok</span>
      </div>
      <div className="w-px h-3 bg-slate-100" />
      <div className="flex items-center gap-1 text-emerald-600">
        <DollarSign className="w-3 h-3" />
        <span className="font-mono font-bold">~{stats.cost.toFixed(4)}</span>
      </div>
      <div className="w-px h-3 bg-slate-100" />
      <div className="flex items-center gap-1 text-slate-500">
        <Cpu className="w-3 h-3" />
        <span className="font-mono">{stats.doneCount}/{stats.agentCount}</span>
      </div>
    </motion.div>
  );
}

// ─── Handoff Pulse (animated particle for swarm hand-offs) ──────────────────
interface HandoffPulseEntry {
  id: string;
  fromRole: string;
  toRole: string;
  startedAt: number; // Date.now()
}

function HandoffPulseOverlay({ pulses, agents }: {
  pulses: HandoffPulseEntry[];
  agents: AgentNode[];
}) {
  if (pulses.length === 0) return null;
  const roleMap = new Map(agents.map(a => [a.role, a]));

  return (
    <>
      {pulses.map((pulse) => {
        const fromCfg = getRoleCfg(pulse.fromRole);
        const toCfg = getRoleCfg(pulse.toRole);
        return (
          <motion.div
            key={pulse.id}
            className="pointer-events-none fixed z-50 flex items-center gap-1.5
              px-3 py-1.5 rounded-full border text-[10px] font-bold shadow-2xl backdrop-blur-sm"
            style={{
              background: `linear-gradient(135deg, ${fromCfg.accentColor}22, ${toCfg.accentColor}22)`,
              borderColor: `${toCfg.accentColor}60`,
              color: toCfg.accentColor,
              bottom: "5rem",
              left: "50%",
              translateX: "-50%",
            }}
            initial={{ opacity: 0, y: 12, scale: 0.85 }}
            animate={{ opacity: [0, 1, 1, 0], y: [12, 0, -4, -16], scale: [0.85, 1, 1, 0.9] }}
            transition={{ duration: 2.2, ease: "easeInOut" }}
          >
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: fromCfg.accentColor }}
              animate={{ scale: [1, 1.5, 1] }}
              transition={{ duration: 0.6, repeat: 3 }}
            />
            <span style={{ color: fromCfg.accentColor }}>{fromCfg.label}</span>
            <motion.span
              className="text-slate-500 mx-1"
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            >→</motion.span>
            <span style={{ color: toCfg.accentColor }}>{toCfg.label}</span>
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: toCfg.accentColor }}
              animate={{ scale: [0.7, 1.4, 0.7] }}
              transition={{ duration: 0.6, repeat: 3, delay: 0.3 }}
            />
          </motion.div>
        );
      })}
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface AgentGraphProps {
  agents: AgentNode[];
  thoughts?: Record<string, string>;
  toolCalls?: Record<string, string>;
  tokenStats?: TokenStats;
  onFocusAgent?: (agentId: string | null) => void;
  className?: string;
  // Phase 4.3 additions
  preparingSpawnSet?: Set<string>;
  spawnedSet?: Set<string>;        // ids already revealed (for isNewlySpawned detection)
  activeTasksByAgent?: Record<string, string>; // agentId → task title from bucket
  managerPulse?: boolean;
  focusedAgentIdFromTask?: string | null; // highlight driven by kanban click
  // Swarm hand-off pulses
  handoffPulses?: HandoffPulseEntry[];
  agentProgress?: Record<string, number>;  // agentId → 0-100
}

export function AgentGraph({
  agents,
  thoughts = {},
  toolCalls = {},
  tokenStats,
  onFocusAgent,
  className,
  preparingSpawnSet = new Set(),
  spawnedSet = new Set(),
  activeTasksByAgent = {},
  managerPulse = false,
  focusedAgentIdFromTask,
  handoffPulses = [],
  agentProgress = {},
}: AgentGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"TB" | "LR">("TB");
  const positionCache = useRef<Record<string, { x: number; y: number }>>({});
  // Track which ids we've already revealed (for isNewlySpawned)
  const revealedRef = useRef<Set<string>>(new Set());

  // Merge external focus (from kanban) with internal focus
  const effectiveFocusId = focusedAgentIdFromTask ?? focusedId;

  const handleFocus = useCallback((id: string) => {
    const next = focusedId === id ? null : id;
    setFocusedId(next);
    onFocusAgent?.(next);
  }, [focusedId, onFocusAgent]);

  useEffect(() => {
    if (agents.length === 0) {
      setNodes([]); setEdges([]); positionCache.current = {};
      revealedRef.current = new Set();
      return;
    }

    const newIds = agents.map(a => a.id).filter(id => !positionCache.current[id]);
    if (newIds.length > 0) {
      const fresh = computeDagreLayout(agents, direction);
      // Auto relayout entire graph when a spawn happens
      Object.assign(positionCache.current, fresh);
    }

    const newNodes: Node[] = agents.map(agent => {
      const isNewlySpawned = !revealedRef.current.has(agent.id);
      if (isNewlySpawned) revealedRef.current.add(agent.id);

      return {
        id: agent.id,
        type: "agentNode",
        position: positionCache.current[agent.id] ?? { x: 0, y: 0 },
        data: {
          agent,
          agentName: getAgentName(agent.id, agent.role),
          thought: thoughts[agent.id],
          toolCall: toolCalls[agent.id],
          focused: effectiveFocusId === agent.id,
          isPreparing: preparingSpawnSet.has(agent.id),
          isNewlySpawned,
          activeTaskTitle: activeTasksByAgent[agent.id],
          isManagerPulsing: managerPulse && (agent.role === "manager" || agent.role === "swarm_dispatcher"),
          agentProgress: agentProgress[agent.id],
          onFocus: handleFocus,
        } as AgentNodeData,
        draggable: true,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
    });

    // Build agent lookup for parent role resolution
    const agentMap = new Map(agents.map(a => [a.id, a]));

    // ── Synthesize parent edges from HANDOFF chain order for swarm agents ───────
    // Swarm agents don't have parent_id set. We infer delegation by ordering:
    // dispatcher is root, then first specialist, then subsequent roles are children
    // of the agent that handed off to them (based on role sequence in handoff chain).
    // We find the most recent handoff target for each role and wire edges.
    const roleToAgent = new Map<string, AgentNode>();
    for (const a of agents) {
      // Prefer working/thinking agents over completed ones for role assignment
      const existing = roleToAgent.get(a.role);
      if (!existing || a.status === "working" || a.status === "thinking") {
        roleToAgent.set(a.role, a);
      }
    }

    const newEdges: Edge[] = agents
      .filter(a => a.parent_id && agentMap.has(a.parent_id))
      .map(a => {
        const parent = agentMap.get(a.parent_id!)!;
        const isActive = a.status === "working" || a.status === "thinking";
        const isDone = a.status === "completed";
        const isError = a.status === "error";
        const childCfg = getRoleCfg(a.role);

        const color = isError ? "#ef4444"
          : isDone ? "#10b98155"
            : isActive ? childCfg.accentColor
              : "#334155";

        const strokeWidth = isActive ? 2.5 : 1.5;

        return {
          id: `e-${a.parent_id}-${a.id}`,
          source: a.parent_id!,
          target: a.id,
          type: "smoothstep",
          animated: isActive,
          style: {
            stroke: color,
            strokeWidth,
            strokeDasharray: isActive || isDone ? undefined : "4 3",
            filter: isActive ? `drop-shadow(0 0 5px ${childCfg.glowColor}90)` : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: isActive ? 14 : 10,
            height: isActive ? 14 : 10,
          },
          // Show delegation label when a manager spawns a child
          ...(parent.role === "manager" ? {
            label: `→ ${childCfg.label}`,
            labelStyle: {
              fill: color,
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "monospace",
              opacity: isActive ? 1 : 0.55,
            },
            labelBgStyle: { fill: "#0f172a", fillOpacity: 0.9 },
            labelBgPadding: [3, 5] as [number, number],
            labelBgBorderRadius: 4,
          } : {}),
        };
      });

    // ── Synthesize sequential "handoff" edges between root managers ─────────────
    // In factory mode, each task creates a new Manager with parent_id=null.
    // We chain them temporally (by created_at) to show the factory task progression.
    const rootManagers = agents
      .filter(a => a.role === "manager" && !a.parent_id)
      .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));

    for (let i = 1; i < rootManagers.length; i++) {
      const prev = rootManagers[i - 1];
      const curr = rootManagers[i];
      const isDone = prev.status === "completed";
      const isError = prev.status === "error";
      const prevCfg = getRoleCfg(prev.role);
      const color = isError ? "#ef444460" : isDone ? "#10b98155" : `${prevCfg.accentColor}60`;
      newEdges.push({
        id: `e-chain-${prev.id}-${curr.id}`,
        source: prev.id,
        target: curr.id,
        type: "smoothstep",
        animated: false,
        style: {
          stroke: color,
          strokeWidth: 1,
          strokeDasharray: "6 4",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 8,
          height: 8,
        },
        label: "next task →",
        labelStyle: {
          fill: "#475569",
          fontSize: 8,
          fontWeight: 600,
          fontFamily: "monospace",
          opacity: 0.6,
        },
        labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
        labelBgPadding: [2, 4] as [number, number],
        labelBgBorderRadius: 3,
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [agents, thoughts, toolCalls, effectiveFocusId, direction, handleFocus,
    preparingSpawnSet, activeTasksByAgent, managerPulse, setNodes, setEdges]);

  const onNodeDragStop: NodeMouseHandler = useCallback((_e, node) => {
    positionCache.current[node.id] = node.position;
  }, []);

  const relayout = useCallback(() => {
    positionCache.current = {};
    const fresh = computeDagreLayout(agents, direction);
    Object.assign(positionCache.current, fresh);
    setNodes(nds => nds.map(n => ({ ...n, position: positionCache.current[n.id] ?? n.position })));
  }, [agents, direction, setNodes]);

  // Empty state is handled by the parent orchestration page overlay

  return (
    <div className={cn("h-full w-full flex flex-col", className)}>
      {/* Swarm handoff pulse overlay */}
      <HandoffPulseOverlay pulses={handoffPulses} agents={agents} />
      <div className="flex-1 min-h-0 relative w-full h-full" style={{ width: '100%', height: '100%' }}>
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
          colorMode="light"
          minZoom={0.15}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="#e7e5e4" />

          <Controls
            className="!bg-white/90 !border-slate-200 !shadow-xl backdrop-blur-sm"
            showInteractive={false}
          />

          <MiniMap
            className="!bg-white/90 !border-slate-200"
            nodeColor={(n) => {
              const role = (n.data as unknown as AgentNodeData).agent?.role ?? "";
              return ROLE_CONFIG[role]?.accentColor ?? "#94a3b8";
            }}
            maskColor="rgba(250, 250, 249, 0.7)"
            nodeStrokeWidth={2}
          />

          {/* Top-right: token stats + layout controls */}
          <Panel position="top-right" className="flex items-center gap-2">
            {tokenStats && <TokenMonitor stats={tokenStats} />}
            <div className="flex items-center gap-0.5 p-1 rounded-xl bg-slate-50/90 backdrop-blur-sm border border-slate-200/80 shadow-xl">
              <button
                onClick={() => setDirection("TB")}
                title="Vertical layout"
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  direction === "TB" ? "bg-indigo-600/30 text-indigo-700" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDirection("LR")}
                title="Horizontal layout"
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  direction === "LR" ? "bg-indigo-600/30 text-indigo-700" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-slate-100 mx-0.5" />
              <button
                onClick={relayout}
                title="Auto-arrange"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </Panel>

          {/* Clear focus indicator */}
          {effectiveFocusId && (
            <Panel position="top-left">
              <motion.button
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => { setFocusedId(null); onFocusAgent?.(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                  bg-slate-50/90 border border-slate-200/80 text-slate-500
                  text-xs font-semibold hover:text-slate-800 transition-colors shadow-xl"
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
