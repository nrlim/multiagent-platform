"use client";

import { useRef, useEffect } from "react";
import {
  Brain, Zap, FileEdit, Terminal as TerminalIcon,
  Package, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { HiveEvent, EventType } from "@/lib/use-hive-socket";

// ─── Event styling ────────────────────────────────────────────────────────────
const EVENT_STYLE: Record<EventType, {
  icon: React.ElementType;
  color: string;
  bg: string;
  label: string;
}> = {
  SPAWN:          { icon: Package,       color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",  label: "Spawn" },
  PREPARING_SPAWN:{ icon: Package,       color: "text-violet-300",  bg: "bg-violet-500/5 border-transparent",     label: "Preparing" },
  STATUS:         { icon: CheckCircle2,  color: "text-slate-500",   bg: "bg-slate-500/10 border-slate-500/20",    label: "Status" },
  THOUGHT:        { icon: Brain,         color: "text-indigo-600",  bg: "bg-indigo-50/50 border-indigo-200",  label: "Thought" },
  TOOL_CALL:      { icon: Zap,          color: "text-amber-600",   bg: "bg-amber-500/10 border-amber-500/20",    label: "Tool" },
  SHELL_OUTPUT:   { icon: TerminalIcon,  color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/20",      label: "Shell" },
  ARTIFACT:       { icon: Package,       color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200",label: "Artifact" },
  FILE_CHANGE:    { icon: FileEdit,      color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20",      label: "File" },
  REVIEW_LOG:     { icon: CheckCircle2,  color: "text-indigo-600",  bg: "bg-indigo-50/50 border-indigo-200",  label: "Review" },
  DESIGN_SPEC:    { icon: Package,       color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",  label: "Design Spec" },
  DONE:           { icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200",label: "Done" },
  ERROR:          { icon: AlertTriangle, color: "text-red-600",     bg: "bg-red-500/10 border-red-500/20",        label: "Error" },
  LOG:            { icon: TerminalIcon,  color: "text-slate-500",   bg: "bg-slate-100/30 border-slate-200/20",    label: "Log" },
  CHAT:           { icon: Brain,         color: "text-violet-300",  bg: "bg-violet-500/5 border-transparent",     label: "Chat" },
  BUCKET_UPDATE:  { icon: CheckCircle2,  color: "text-indigo-600",  bg: "bg-indigo-500/5 border-transparent",     label: "Bucket" },
  FACTORY_START:  { icon: Zap,          color: "text-indigo-600",  bg: "bg-indigo-500/5 border-transparent",     label: "Factory" },
  FACTORY_PROGRESS:{ icon: Zap,         color: "text-slate-500",   bg: "bg-transparent border-transparent",      label: "" },
  FACTORY_DONE:   { icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-500/5 border-transparent",    label: "Factory Done" },
  HANDOFF:        { icon: Zap,           color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",  label: "Handoff" },
  SWARM_DONE:     { icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200",label: "Swarm Done" },
  keepalive:      { icon: CheckCircle2,  color: "text-slate-700",   bg: "bg-transparent border-transparent",      label: "" },
  pong:           { icon: CheckCircle2,  color: "text-slate-700",   bg: "bg-transparent border-transparent",      label: "" },
};


// ─── Extract displayable text from event data ─────────────────────────────────
function extractText(event: HiveEvent): string {
  if (typeof event.data === "string") return event.data;
  const d = event.data as Record<string, unknown>;

  switch (event.event_type) {
    case "SPAWN":   return `Spawned [${d.role}]: ${String(d.task_preview ?? "").slice(0, 80)}`;
    case "STATUS":  return `[${d.role}] → ${d.status}`;
    case "THOUGHT": return d.line ? String(d.line) : `Reasoning about: ${String(d.task_preview ?? "").slice(0, 80)}`;
    case "TOOL_CALL": return `${d.tool}${d.path ? `: ${d.path}` : d.command ? `: ${d.command}` : ""}`;
    case "SHELL_OUTPUT": return String(d.line ?? "");
    case "FILE_CHANGE": return `${d.op} ${d.path}${d.size ? ` (${d.size}b)` : ""}`;
    case "ARTIFACT": return `Published [${d.topic}] to message bus`;
    case "DONE":    return d.success ? "Hive session completed successfully" : `Failed: ${(d.failed as string[])?.join(", ")}`;
    case "ERROR":   return String(d.error ?? "Unknown error");
    default: return JSON.stringify(event.data).slice(0, 120);
  }
}

// ─── Single feed item ─────────────────────────────────────────────────────────
interface FeedItemProps {
  event: HiveEvent;
  agentRole?: string;
}

function FeedItem({ event, agentRole }: FeedItemProps) {
  const style = EVENT_STYLE[event.event_type] ?? EVENT_STYLE.LOG;
  if (!style.label) return null; // skip keepalive/pong
  const Icon = style.icon;
  const text = extractText(event);
  if (!text.trim()) return null;

  return (
    <div
      className={cn(
        "flex gap-2.5 px-3 py-2 rounded-lg border transition-all",
        style.bg,
        event.event_type === "THOUGHT" && "ml-4",
        event.event_type === "SHELL_OUTPUT" && "ml-8 font-mono",
      )}
    >
      <div className="shrink-0 mt-0.5">
        <Icon className={cn("w-3 h-3", style.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn("text-[9px] font-bold uppercase tracking-wider", style.color)}>
            {style.label}
          </span>
          {agentRole && (
            <span className="text-[9px] text-slate-600 font-mono">
              [{agentRole}]
            </span>
          )}
          <span className="ml-auto text-[9px] text-slate-700 font-mono">
            {new Date(event.timestamp).toLocaleTimeString("en", {
              hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
            })}
          </span>
        </div>
        <p className={cn(
          "text-xs leading-snug break-words",
          event.event_type === "THOUGHT" ? "text-indigo-700/80 italic" : "text-slate-700",
          event.event_type === "SHELL_OUTPUT" && "text-cyan-300/80 text-[10px]",
          event.event_type === "ERROR" && "text-red-300",
        )}>
          {text}
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface ActivityFeedProps {
  events: HiveEvent[];
  agentRoles?: Record<string, string>;  // agentId → role
  className?: string;
  filter?: EventType[];
}

export function ActivityFeed({ events, agentRoles = {}, className, filter }: ActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const visibleEvents = filter
    ? events.filter((e) => filter.includes(e.event_type))
    : events;

  return (
    <div className={cn("flex flex-col gap-1.5 p-3 overflow-y-auto", className)}>
      {visibleEvents.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-slate-700 text-sm">
          <div className="text-center">
            <Brain className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p>Waiting for agent activity...</p>
          </div>
        </div>
      ) : (
        visibleEvents.map((event) => (
          <FeedItem
            key={event.id}
            event={event}
            agentRole={agentRoles[event.agent_id]}
          />
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
