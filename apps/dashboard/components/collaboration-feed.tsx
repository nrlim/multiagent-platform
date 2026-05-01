"use client";

import { useEffect, useRef, useMemo, memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, CheckCircle2, AlertTriangle, LogIn,
  Zap, Eye, EyeOff, FileCode2,
  Terminal as TerminalIcon, Users, Hash, MessageSquare,
  Server, Globe, Database, FlaskConical, Code2, FileText, User,
  ArrowRightLeft, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { HiveEvent } from "@/lib/use-hive-socket";

// ─── Human-readable display names for agent roles ────────────────────────────
const ROLE_DISPLAY: Record<string, string> = {
  swarm_dispatcher:  "Dispatcher",
  uiux_scout:        "UX Scout",
  uiux_researcher:   "UX Researcher",
  backend_dev:       "Backend Dev",
  frontend_dev:      "Frontend Dev",
  qa_engineer:       "QA Engineer",
  code_reviewer:     "Code Reviewer",
  manager:           "Manager",
  business_analyst:  "Business Analyst",
  database_architect:"DB Architect",
  devops_engineer:   "DevOps Engineer",
  tech_writer:       "Tech Writer",
};

function roleLabel(role: string): string {
  return ROLE_DISPLAY[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Role config ──────────────────────────────────────────────────────────────
const ROLE_CFG: Record<string, {
  bg: string; ring: string; text: string; icon: React.ElementType; presence: string
}> = {
  manager: { bg: "bg-indigo-600", ring: "ring-indigo-400", text: "text-indigo-700", icon: Brain, presence: "Planning" },
  database_architect: { bg: "bg-sky-600", ring: "ring-sky-400", text: "text-sky-700", icon: Database, presence: "Designing Schema" },
  devops_engineer: { bg: "bg-slate-500", ring: "ring-slate-400", text: "text-slate-700", icon: Code2, presence: "Deploying" },
  tech_writer: { bg: "bg-violet-500", ring: "ring-violet-400", text: "text-violet-700", icon: FileText, presence: "Documenting" },
  // Swarm roles
  swarm_dispatcher: { bg: "bg-indigo-500", ring: "ring-indigo-300", text: "text-indigo-800", icon: Brain, presence: "Routing" },
  uiux_scout: { bg: "bg-purple-500", ring: "ring-purple-300", text: "text-purple-700", icon: Globe, presence: "Researching" },
  uiux_researcher: { bg: "bg-violet-600", ring: "ring-violet-400", text: "text-violet-700", icon: Globe, presence: "Deep Research" },
  backend_dev: { bg: "bg-emerald-500", ring: "ring-emerald-300", text: "text-emerald-700", icon: Server, presence: "Building API" },
  frontend_dev: { bg: "bg-amber-500", ring: "ring-amber-300", text: "text-amber-700", icon: Globe, presence: "Crafting UI" },
  qa_engineer: { bg: "bg-pink-500", ring: "ring-pink-300", text: "text-pink-700", icon: ShieldCheck, presence: "Reviewing" },
  code_reviewer: { bg: "bg-rose-500", ring: "ring-rose-300", text: "text-rose-700", icon: ShieldCheck, presence: "Code Review" },
};
const DEFAULT_ROLE = { bg: "bg-slate-700", ring: "ring-slate-500", text: "text-slate-600", icon: User, presence: "Processing" };

function getRoleCfg(role?: string) {
  return ROLE_CFG[role ?? ""] ?? DEFAULT_ROLE;
}

// ─── Deterministic agent name (same seed logic as agent-graph) ────────────────
const AGENT_NAMES: Record<string, string[]> = {
  manager: ["Alex", "Jordan", "Sam", "Riley", "Morgan"],
  business_analyst: ["Priya", "Chris", "Dana", "Robin", "Casey"],
  database_architect: ["Zara", "Leo", "Mia", "Ivan", "Nadia"],
  devops_engineer: ["Axel", "Nora", "Cyrus", "Demi", "Felix"],
  tech_writer: ["Quinn", "Erin", "Hana", "Beau", "Tara"],
  swarm_dispatcher: ["Orion", "Lyra", "Atlas", "Nova", "Zephyr"],
  uiux_scout: ["Iris", "Ciel", "Muse", "Aurora", "Pixel"],
  uiux_researcher: ["Maya", "Cleo", "Theo", "Isla", "Ravi"],
  backend_dev: ["Forge", "Nexus", "Cipher", "Arc", "Byte"],
  frontend_dev: ["Blaze", "Flux", "Prism", "Wave", "Glow"],
  qa_engineer: ["Shield", "Bastion", "Aegis", "Vance", "Sentinel"],
  code_reviewer: ["Marcus", "Yuki", "Aiden", "Vera", "Tobias"],
};

function getAgentName(agentId: string, role: string): string {
  const pool = AGENT_NAMES[role] ?? ["Agent"];
  const seed = parseInt(agentId.replace(/-/g, "").slice(-4), 16);
  return pool[seed % pool.length];
}


// ─── Animated typing indicator ────────────────────────────────────────────────
const TypingDots = memo(function TypingDots({ color = "bg-slate-400" }: { color?: string }) {
  return (
    <span className="inline-flex items-end gap-0.5 h-3">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={cn("rounded-full w-1.5 h-1.5", color)}
          animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  );
});

// ─── Code reference pill ──────────────────────────────────────────────────────
function CodeRefPill({ path }: { path: string }) {
  const isCmd = /^(npm|pip|python|cd |git |yarn |pnpm )/.test(path.trim()) ||
    (!path.includes("/") && path.includes(" "));

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] mt-1",
      isCmd
        ? "bg-slate-50 text-cyan-400 border border-slate-200"
        : "bg-slate-50 text-blue-400 border border-slate-200"
    )}>
      {isCmd ? <TerminalIcon className="w-3 h-3 shrink-0" /> : <FileCode2 className="w-3 h-3 shrink-0" />}
      {path}
    </span>
  );
}

// ─── @mention rendering ───────────────────────────────────────────────────────
function renderWithMentions(text: string, agentRoles: Record<string, string>): React.ReactNode {
  const allRoles = [...new Set(Object.values(agentRoles))];
  const parts = text.split(/(@[\w_]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      const roleName = part.slice(1).toLowerCase();
      const match = allRoles.find(r => r.toLowerCase().replace(/_/g, "") === roleName.replace(/_/g, ""));
      const cfg = match ? getRoleCfg(match) : DEFAULT_ROLE;
      return (
        <span key={i} className={cn(
          "font-bold px-1 py-0.5 rounded text-xs",
          cfg.text, "bg-slate-100"
        )}>
          {part}
        </span>
      );
    }
    return part;
  });
}

// ─── System notification row ──────────────────────────────────────────────────
function SystemRow({ text, type }: { text: string; type: string }) {
  const [Icon, color, bg] = type === "join"
    ? [LogIn, "text-violet-400", "bg-violet-950/60 border-violet-800/30"]
    : type === "done"
      ? [CheckCircle2, "text-emerald-600", "bg-emerald-50 border-emerald-800/30"]
      : type === "error"
        ? [AlertTriangle, "text-red-600", "bg-red-950/60 border-red-800/30"]
        : [Zap, "text-slate-500", "bg-white border-slate-200/30"];
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 py-1 px-4"
    >
      <div className="flex-1 h-px bg-slate-100" />
      <div className={cn(
        "flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-medium",
        bg, color
      )}>
        <Icon className={cn("w-3 h-3")} />
        {text}
      </div>
      <div className="flex-1 h-px bg-slate-100" />
    </motion.div>
  );
}

// ─── Handoff Event Chip (swarm hand-off visualisation) ────────────────────────
function HandoffChip({ event }: { event: HiveEvent }) {
  const data = (typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const fromRole = String(data.from_role ?? "");
  const toRole = String(data.to_role ?? "");
  const reason = String(data.reason ?? "");
  const hop = Number(data.hop ?? 0);
  const isSwarmDone = event.event_type === "SWARM_DONE";

  if (isSwarmDone) {
    const finalOutput = String((data as Record<string, unknown>).final_output ?? "");
    const hops = Number((data as Record<string, unknown>).hops ?? 0);
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-4 my-2 flex items-center gap-3 px-4 py-3 rounded-xl
          bg-gradient-to-r from-emerald-950/60 to-teal-950/60
          border border-emerald-200 shadow-lg"
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-emerald-700">Swarm task complete ({hops} hops)</p>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{finalOutput}</p>
        </div>
      </motion.div>
    );
  }

  // HANDOFF chip
  const fromCfg = ROLE_CFG[fromRole] ?? { text: "text-slate-500", bg: "bg-slate-700", icon: User, ring: "" };
  const toCfg = ROLE_CFG[toRole] ?? { text: "text-slate-500", bg: "bg-slate-700", icon: User, ring: "" };
  const FromIcon = fromCfg.icon;
  const ToIcon = toCfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="mx-4 my-1.5 flex items-center gap-2 px-3 py-2 rounded-xl
        bg-gradient-to-r from-violet-950/50 to-indigo-950/50
        border border-violet-700/30 shadow-md"
    >
      <ArrowRightLeft className="w-3.5 h-3.5 text-violet-400 shrink-0" />
      <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold", fromCfg.bg + "/30", fromCfg.text)}>
        <FromIcon className="w-3 h-3" />
        {roleLabel(fromRole)}
      </div>
      <motion.span
        className="text-violet-400 text-xs font-bold"
        animate={{ x: [0, 3, 0] }}
        transition={{ duration: 0.8, repeat: Infinity }}
      >→</motion.span>
      <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold", toCfg.bg + "/30", toCfg.text)}>
        <ToIcon className="w-3 h-3" />
        {roleLabel(toRole)}
      </div>
      {reason && (
        <span className="text-[9px] text-slate-500 ml-1 truncate flex-1" title={reason}>
          — {reason.slice(0, 60)}{reason.length > 60 ? "…" : ""}
        </span>
      )}
      <span className="text-[9px] text-violet-700 shrink-0">hop {hop}</span>
    </motion.div>
  );
}

// ─── Inner thought bubble ─────────────────────────────────────────────────────
const ThoughtBubble = memo(function ThoughtBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.button
      onClick={() => setExpanded(e => !e)}
      className="flex items-start gap-1.5 text-left mt-0.5 w-full group"
      whileHover={{ x: 2 }}
    >
      <Brain className="w-3 h-3 text-indigo-600/50 shrink-0 mt-0.5 group-hover:text-indigo-600 transition-colors" />
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.p
            key="exp"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[10px] text-indigo-700/60 italic leading-snug overflow-hidden"
          >
            {text}
          </motion.p>
        ) : (
          <motion.span
            key="col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] text-indigo-600/40 italic hover:text-indigo-600/70 transition-colors"
          >
            thinking… <span className="underline decoration-dotted">tap to see</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
});

// ─── Chat data type ─────────────────────────────────────────────────────────────
interface ChatData {
  type: "chat" | "system" | "thought";
  role: string;
  display: string;
  text: string;
  mentions: string[];
  code_ref: string | null;
  is_inner: boolean;
}

// ─── Individual chat bubble ───────────────────────────────────────────────────
interface ChatMessageProps {
  event: HiveEvent;
  chatData: ChatData;
  isFirst: boolean;
  agentName: string;
  agentRoles: Record<string, string>;
  showInner: boolean;
}

const ChatMessage = memo(function ChatMessage({ event, chatData, isFirst, agentName, agentRoles, showInner }: ChatMessageProps) {
  const { type, role, text, code_ref, is_inner } = chatData;

  if (type === "system" || event.event_type === "SPAWN" || event.event_type === "DONE" || event.event_type === "ERROR") {
    const notifType =
      event.event_type === "SPAWN" ? "join" :
        event.event_type === "DONE" ? "done" :
          event.event_type === "ERROR" ? "error" : "info";
    const notifText = text ||
      (event.event_type === "SPAWN" ? `${agentName} joined the session` :
        event.event_type === "DONE" ? `${agentName} completed task` :
          event.event_type === "ERROR" ? `${agentName} encountered an error` : "System event");
    return <SystemRow text={notifText} type={notifType} />;
  }

  // Swarm hand-off events render as special chips
  if (event.event_type === "HANDOFF" || event.event_type === "SWARM_DONE") {
    return <HandoffChip event={event} />;
  }

  if (is_inner && !showInner) return null;
  if (type === "thought" && is_inner && showInner) {
    return (
      <div className="pl-11 pr-4">
        <ThoughtBubble text={text} />
      </div>
    );
  }

  const cfg = getRoleCfg(role || agentRoles[event.agent_id]);
  const RoleIcon = cfg.icon;
  const time = new Date(event.timestamp).toLocaleTimeString("en", {
    hour12: false, hour: "2-digit", minute: "2-digit",
  });

  // For THOUGHT events shown to user: render as a softer bubble
  const isThought = event.event_type === "THOUGHT" || type === "thought";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      className="flex items-start gap-2.5 px-4 group hover:bg-slate-50/50 rounded-lg py-0.5 mx-1 transition-colors"
    >
      {/* Avatar column */}
      <div className="shrink-0 w-10 mt-1">
        {isFirst ? (
          <div className={cn(
            "w-10 h-10 rounded-[14px] flex items-center justify-center shadow-lg shadow-black/10 ring-2 ring-white",
            cfg.bg,
          )}>
            <RoleIcon className="w-5 h-5 text-white/90" />
          </div>
        ) : (
          <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity
            flex items-center justify-end w-full pt-1 pr-1">
            {time}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isFirst && (
          <div className="flex items-baseline gap-2 mb-1.5 ml-1">
            <span className={cn("text-sm font-bold", cfg.text)}>{agentName}</span>
            <span className="text-[10px] text-slate-400 font-medium">{roleLabel(role || agentRoles[event.agent_id] || "")}</span>
            <span className="text-[10px] text-slate-400">{time}</span>
            {isThought && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-600">
                thinking
              </span>
            )}
          </div>
        )}

        {/* Bubble */}
        <div className={cn(
          "inline-block max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isFirst && "rounded-tl-sm",
          isThought
            ? "bg-indigo-50 border border-indigo-100 italic text-indigo-700"
            : "bg-white border border-slate-200 text-slate-800",
        )}>
          <p className="break-words whitespace-pre-wrap leading-relaxed">
            {renderWithMentions(text, agentRoles)}
          </p>
          {code_ref && (
            <div className="mt-1.5">
              <CodeRefPill path={code_ref} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

// ─── Online presence sidebar ──────────────────────────────────────────────────
interface PresenceSidebarProps {
  agentRoles: Record<string, string>;
  activeAgents: Set<string>;
  focusedAgentId?: string | null;
  onFocus: (id: string | null) => void;
}

function PresenceSidebar({ agentRoles, activeAgents, focusedAgentId, onFocus }: PresenceSidebarProps) {
  const rows = Object.entries(agentRoles);
  if (rows.length === 0) return null;
  return (
    <div className="w-44 shrink-0 border-l border-slate-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-1.5">
          <Users className="w-3 h-3 text-slate-600" />
          <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">
            Team ({rows.length})
          </span>
        </div>
        {activeAgents.size > 0 && (
          <p className="text-[8px] text-emerald-600 mt-0.5">
            {activeAgents.size} active now
          </p>
        )}
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
        {rows.map(([id, role]) => {
          const cfg = getRoleCfg(role);
          const name = getAgentName(id, role);
          const isActive = activeAgents.has(id);
          const isFocused = focusedAgentId === id;
          return (
            <button
              key={id}
              onClick={() => onFocus(isFocused ? null : id)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-xl text-left w-full transition-all",
                isFocused ? "bg-slate-100" : "hover:bg-slate-100/40"
              )}
            >
              <div className="relative shrink-0">
                <div className={cn(
                  "w-7 h-7 rounded-xl flex items-center justify-center shadow-sm",
                  cfg.bg
                )}>
                  {(() => { const RI = cfg.icon; return <RI className="w-3.5 h-3.5 text-white/90" />; })()}
                </div>
                {/* Status dot */}
                <motion.div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white",
                    isActive ? "bg-emerald-400" : "bg-slate-300"
                  )}
                  animate={isActive ? { scale: [1, 1.3, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-800 truncate">{name}</p>
                <p className={cn("text-[9px] truncate", isActive ? cfg.text : "text-slate-400")}>
                  {isActive ? (
                    <span className="flex items-center gap-0.5">
                      <TypingDots color={cfg.bg.replace("bg-", "bg-")} />
                      {cfg.presence}
                    </span>
                  ) : roleLabel(role)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface CollaborationFeedProps {
  events: HiveEvent[];
  agentRoles?: Record<string, string>;
  focusedAgentId?: string | null;
  onFocusAgent?: (id: string | null) => void;
  activeAgents?: Set<string>;
  className?: string;
}

export function CollaborationFeed({
  events,
  agentRoles = {},
  focusedAgentId,
  onFocusAgent,
  activeAgents = new Set(),
  className,
}: CollaborationFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  // showAll=false → only CHAT + HANDOFF + SWARM_DONE (human communications)
  // showAll=true  → everything including SPAWN/DONE/ERROR/THOUGHT (log view)
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  // ── HUMAN COMMUNICATION types (default view) ──────────────────────────────
  // Only show messages that feel like real team communication
  const COMM_TYPES = new Set(["CHAT", "HANDOFF", "SWARM_DONE"]);

  // ── ALL event types (log view when eye toggled on) ────────────────────────
  const ALL_TYPES = new Set(["CHAT", "HANDOFF", "SWARM_DONE", "SPAWN", "DONE", "ERROR", "THOUGHT"]);

  const chatEvents = useMemo(() => {
    const SHOW_TYPES = showAll ? ALL_TYPES : COMM_TYPES;
    const filtered = focusedAgentId
      ? events.filter(e => e.agent_id === focusedAgentId || e.event_type === "HANDOFF" || e.event_type === "SWARM_DONE")
      : events;
    return filtered.filter(e => SHOW_TYPES.has(e.event_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, focusedAgentId, showAll]);

  // Group consecutive messages from the same agent
  const withMeta = useMemo(() =>
    chatEvents
      .map((ev, i) => ({
        ev,
        chatData: (typeof ev.data === "object" ? ev.data : {}) as unknown as ChatData,
        isFirst: i === 0 || chatEvents[i - 1].agent_id !== ev.agent_id,
        agentName: getAgentName(ev.agent_id, agentRoles[ev.agent_id] ?? ""),
      }))
      .filter(({ chatData, ev }) =>
        ["HANDOFF", "SWARM_DONE", "SPAWN", "DONE", "ERROR"].includes(ev.event_type) || chatData.text?.trim()
      ),
    [chatEvents, agentRoles]);

  const isEmpty = withMeta.length === 0;

  // Who is currently typing
  const typingAgents = useMemo(() => {
    const recentSenders = new Set(chatEvents.slice(-6).map(e => e.agent_id));
    return [...activeAgents].filter(id => {
      const role = agentRoles[id];
      return role && !recentSenders.has(id);
    });
  }, [activeAgents, chatEvents, agentRoles]);

  return (
    <div className={cn("flex h-full min-h-0 overflow-hidden", className)}>

      {/* ── Main chat area ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white shrink-0">
          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[11px] text-slate-600 font-bold">team-comms</span>
          {focusedAgentId && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center gap-1">
              {getAgentName(focusedAgentId, agentRoles[focusedAgentId] ?? "")}
              <button onClick={() => onFocusAgent?.(null)} className="ml-0.5 hover:text-indigo-800 font-bold">×</button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Comm count badge */}
            <span className="text-[10px] text-slate-400 font-mono">{withMeta.length}</span>
            {/* Eye toggle: default = hide logs, show = all logs visible */}
            <button
              onClick={() => setShowAll(s => !s)}
              title={showAll ? "Show human communications only" : "Show all events including logs"}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-semibold border transition-all",
                showAll
                  ? "bg-slate-800 border-slate-600 text-slate-200"
                  : "bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-700"
              )}
            >
              {showAll ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {showAll ? "All Events" : "Comms Only"}
            </button>
          </div>
        </div>

        {/* Comms-only hint banner */}
        {!showAll && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-indigo-50/60 border-b border-indigo-100 shrink-0">
            <Users className="w-3 h-3 text-indigo-400 shrink-0" />
            <span className="text-[10px] text-indigo-600 font-medium">
              Showing agent communications — click <EyeOff className="inline w-2.5 h-2.5 mx-0.5" /> to include system logs
            </span>
          </div>
        )}

        {/* Messages feed */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5 min-h-0 w-full relative">
          <AnimatePresence initial={false}>
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 pt-16">
                <motion.div
                  animate={{ opacity: [0.2, 0.5, 0.2], scale: [0.96, 1.04, 0.96] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center"
                >
                  <MessageSquare className="w-6 h-6 text-slate-400" />
                </motion.div>
                <div className="text-center px-4 space-y-1">
                  <p className="text-sm text-slate-600">Agent communications will appear here once the Hive starts</p>
                  <p className="text-[11px] text-slate-500">Human-readable messages only — click the eye icon to see all events</p>
                </div>
              </div>
            ) : (
              withMeta.map(({ ev, chatData, isFirst, agentName }, i) => (
                <ChatMessage
                  key={`${ev.id}-${i}`}
                  event={ev}
                  chatData={{ ...chatData, display: chatData.display || agentName }}
                  isFirst={isFirst}
                  agentName={agentName}
                  agentRoles={agentRoles}
                  showInner={showAll}
                />
              ))
            )}
          </AnimatePresence>

          {/* Typing indicator */}
          <AnimatePresence>
            {typingAgents.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-4 py-1.5"
              >
                <div className="flex -space-x-1">
                  {typingAgents.slice(0, 3).map(id => {
                    const cfg = getRoleCfg(agentRoles[id]);
                    const TI = cfg.icon;
                    return (
                      <div key={id} className={cn("w-5 h-5 rounded-full border-2 border-white flex items-center justify-center", cfg.bg)}>
                        <TI className="w-3 h-3 text-white/90" />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-slate-100 border border-slate-200">
                  <TypingDots />
                  <span className="text-[10px] text-slate-500">
                    {typingAgents.length === 1
                      ? `${getAgentName(typingAgents[0], agentRoles[typingAgents[0]] ?? "")} is typing`
                      : `${typingAgents.length} agents are typing`}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}