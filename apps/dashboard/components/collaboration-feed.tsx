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

// ─── Role config (icon-based, no emojis) ──────────────────────────────────────
const ROLE_CFG: Record<string, {
  bg: string; ring: string; text: string; icon: React.ElementType; presence: string
}> = {
  manager:            { bg: "bg-indigo-600",   ring: "ring-indigo-400",  text: "text-indigo-700",  icon: Brain,        presence: "Planning" },
  database_architect: { bg: "bg-sky-600",      ring: "ring-sky-400",     text: "text-sky-300",     icon: Database,     presence: "Designing Schema" },
  backend_dev:        { bg: "bg-emerald-600",  ring: "ring-emerald-400", text: "text-emerald-700", icon: Server,       presence: "Writing Code" },
  frontend_dev:       { bg: "bg-amber-500",    ring: "ring-amber-400",   text: "text-amber-700",   icon: Globe,        presence: "Building UI" },
  qa_engineer:        { bg: "bg-pink-600",     ring: "ring-pink-400",    text: "text-pink-300",    icon: FlaskConical, presence: "Reviewing" },
  devops_engineer:    { bg: "bg-slate-500",    ring: "ring-slate-400",   text: "text-slate-700",   icon: Code2,        presence: "Deploying" },
  tech_writer:        { bg: "bg-violet-500",   ring: "ring-violet-400",  text: "text-violet-300",  icon: FileText,     presence: "Documenting" },
  // Swarm roles
  swarm_dispatcher:   { bg: "bg-indigo-500",   ring: "ring-indigo-300",  text: "text-indigo-800",  icon: Brain,        presence: "Routing" },
  uiux_scout:         { bg: "bg-purple-500",   ring: "ring-purple-300",  text: "text-purple-200",  icon: Globe,        presence: "Researching" },
  logic_weaver:       { bg: "bg-emerald-500",  ring: "ring-emerald-300", text: "text-emerald-200", icon: Server,       presence: "Building API" },
  pixel_crafter:      { bg: "bg-amber-500",    ring: "ring-amber-300",   text: "text-amber-200",   icon: Globe,        presence: "Crafting UI" },
  guardian:           { bg: "bg-pink-500",     ring: "ring-pink-300",    text: "text-pink-200",    icon: ShieldCheck,  presence: "Reviewing" },
};
const DEFAULT_ROLE = { bg: "bg-slate-700", ring: "ring-slate-500", text: "text-slate-500", icon: User, presence: "Processing" };

function getRoleCfg(role?: string) {
  return ROLE_CFG[role ?? ""] ?? DEFAULT_ROLE;
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
  const fromRole  = String(data.from_role ?? "");
  const toRole    = String(data.to_role   ?? "");
  const reason    = String(data.reason    ?? "");
  const hop       = Number(data.hop       ?? 0);
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
  const toCfg   = ROLE_CFG[toRole]   ?? { text: "text-slate-500", bg: "bg-slate-700", icon: User, ring: "" };
  const FromIcon = fromCfg.icon;
  const ToIcon   = toCfg.icon;

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
        {fromRole.replace(/_/g, " ")}
      </div>
      <motion.span
        className="text-violet-400 text-xs font-bold"
        animate={{ x: [0, 3, 0] }}
        transition={{ duration: 0.8, repeat: Infinity }}
      >→</motion.span>
      <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold", toCfg.bg + "/30", toCfg.text)}>
        <ToIcon className="w-3 h-3" />
        {toRole.replace(/_/g, " ")}
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
  agentRoles: Record<string, string>;
  showInner: boolean;
}

const ChatMessage = memo(function ChatMessage({ event, chatData, isFirst, agentRoles, showInner }: ChatMessageProps) {
  const { type, role, display, text, code_ref, is_inner } = chatData;

  if (type === "system") {
    const notifType =
      event.event_type === "SPAWN" ? "join" :
      event.event_type === "DONE"  ? "done" :
      event.event_type === "ERROR" ? "error" : "info";
    return <SystemRow text={text} type={notifType} />;
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

  const cfg = getRoleCfg(role);
  const RoleIcon = cfg.icon;
  const time = new Date(event.timestamp).toLocaleTimeString("en", {
    hour12: false, hour: "2-digit", minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
      className="flex items-start gap-2.5 px-4 group hover:bg-white/[0.015] rounded-lg py-0.5 mx-1 transition-colors"
    >
      {/* Avatar column — only show for first message in a run */}
      <div className="shrink-0 w-10 mt-1">
        {isFirst ? (
          <div className={cn(
            "w-10 h-10 rounded-[14px] flex items-center justify-center shadow-lg shadow-black/20 ring-1 ring-white/10",
            cfg.bg,
          )}>
            <RoleIcon className="w-5 h-5 text-white/90" />
          </div>
        ) : (
          /* Timestamp placeholder on hover */
          <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity
            flex items-center justify-end w-full pt-1 pr-1">
            {time}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isFirst && (
          <div className="flex items-baseline gap-2 mb-1.5 ml-1">
            <span className={cn("text-sm font-bold capitalize tracking-wide", cfg.text)}>
              {display}
            </span>
            <span className="text-[10px] text-slate-500 font-medium">{time}</span>
            {type === "thought" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-200 text-indigo-700 shadow-sm shadow-indigo-900/20">
                thinking
              </span>
            )}
          </div>
        )}

        {/* Bubble */}
        <div className={cn(
          "inline-block max-w-[92%] rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm",
          isFirst && "rounded-tl-sm",
          type === "thought"
            ? "bg-indigo-950/30 border border-indigo-800/30 italic text-indigo-800/90"
            : "bg-slate-100/70 backdrop-blur-md border border-slate-200 text-slate-900",
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
                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950",
                    isActive ? "bg-emerald-400" : "bg-slate-700"
                  )}
                  animate={isActive ? { scale: [1, 1.3, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-slate-700 truncate capitalize">
                  {role.replace(/_/g, " ")}
                </p>
                <p className={cn("text-[8px] truncate", isActive ? cfg.text : "text-slate-600")}>
                  {isActive ? (
                    <span className="flex items-center gap-0.5">
                      <TypingDots color={cfg.bg.replace("bg-", "bg-")} />
                      {cfg.presence}
                    </span>
                  ) : "Idle"}
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
  const [showInner, setShowInner] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  // Filter to CHAT events only (natural-language dialogue from dialogue.py)
  const chatEvents = useMemo(() => {
    const filtered = focusedAgentId
      ? events.filter(e => e.agent_id === focusedAgentId)
      : events;
    return filtered.filter(e => e.event_type === "CHAT");
  }, [events, focusedAgentId]);

  // Group consecutive messages from the same agent
  const withMeta = useMemo(() =>
    chatEvents
      .map((ev, i) => ({
        ev,
        chatData: (typeof ev.data === "object" ? ev.data : {}) as unknown as ChatData,
        isFirst: i === 0 || chatEvents[i - 1].agent_id !== ev.agent_id,
      }))
      .filter(({ chatData }) => chatData.text?.trim()),
  [chatEvents]);

  const isEmpty = withMeta.length === 0;

  // Who is currently typing (active agents that have not sent a message recently)
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
          <Hash className="w-3.5 h-3.5 text-slate-600" />
          <span className="text-[11px] text-slate-500 font-bold">activity-feed</span>
          {focusedAgentId && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-700/30 text-violet-400">
              Filtered: {(agentRoles[focusedAgentId] ?? "agent").replace(/_/g, " ")}
              <button onClick={() => onFocusAgent?.(null)} className="ml-1.5 hover:text-white">×</button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowInner(s => !s)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-medium border transition-all",
                showInner
                  ? "bg-indigo-900/40 border-indigo-200 text-indigo-700"
                  : "bg-slate-100/40 border-slate-200 text-slate-500 hover:text-slate-700"
              )}
            >
              {showInner ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              Inner thoughts
            </button>
          </div>
        </div>

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
                  <MessageSquare className="w-6 h-6 text-slate-600" />
                </motion.div>
                <div className="text-center px-4 space-y-1">
                  <p className="text-sm text-slate-600">Agent communications will appear here once the Hive starts</p>
                  <p className="text-[11px] text-slate-700">Humanized messages — raw logs and shell output are in their own tabs</p>
                </div>
              </div>
            ) : (
              withMeta.map(({ ev, chatData, isFirst }, i) => (
                <ChatMessage
                  key={`${ev.id}-${i}`}
                  event={ev}
                  chatData={chatData}
                  isFirst={isFirst}
                  agentRoles={agentRoles}
                  showInner={showInner}
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
                      <div key={id} className={cn("w-5 h-5 rounded-full border-2 border-slate-950 flex items-center justify-center", cfg.bg)}>
                        <TI className="w-3 h-3 text-white/90" />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-slate-100 border border-slate-200">
                  <TypingDots />
                  <span className="text-[10px] text-slate-500">
                    {typingAgents.length === 1
                      ? `${(agentRoles[typingAgents[0]] ?? "Agent").replace(/_/g, " ")} is typing`
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
