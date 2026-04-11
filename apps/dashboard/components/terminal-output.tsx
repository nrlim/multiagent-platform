"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SessionLog } from "@/lib/engine-client";

interface TerminalOutputProps {
  logs: SessionLog[];
  isRunning?: boolean;
  className?: string;
}

const LOG_STYLES: Record<string, { color: string; prefix: string }> = {
  info:    { color: "text-slate-300",  prefix: "›" },
  success: { color: "text-emerald-400", prefix: "✓" },
  warning: { color: "text-amber-400",  prefix: "⚠" },
  error:   { color: "text-red-400",    prefix: "✗" },
  command: { color: "text-cyan-400",   prefix: "$" },
  file:    { color: "text-violet-400", prefix: "⊕" },
};

export function TerminalOutput({ logs, isRunning, className }: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Terminal header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-700/50 rounded-t-lg">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-amber-500/80" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-xs text-slate-500 font-mono ml-2">agent-output</span>
        {isRunning && (
          <Badge
            variant="outline"
            className="ml-auto text-xs border-emerald-500/50 text-emerald-400 animate-pulse"
          >
            ● LIVE
          </Badge>
        )}
        {!isRunning && logs.length > 0 && (
          <span className="ml-auto text-xs text-slate-500 font-mono">
            {logs.length} lines
          </span>
        )}
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-y-auto bg-slate-950 rounded-b-lg">
        <div className="p-4 font-mono text-sm space-y-0.5 min-h-[200px]">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-600">
              <span>Waiting for agent output...</span>
            </div>
          ) : (
            logs.map((log) => {
              const style = LOG_STYLES[log.level] ?? LOG_STYLES.info;
              return (
                <div
                  key={log.id}
                  className="flex gap-2 group hover:bg-slate-800/30 rounded px-1 transition-colors"
                >
                  <span className="text-slate-600 text-xs pt-0.5 select-none shrink-0 w-16 truncate">
                    {new Date(log.timestamp).toLocaleTimeString("en", {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className={cn("shrink-0 w-4", style.color)}>
                    {style.prefix}
                  </span>
                  <span className={cn("break-all leading-relaxed", style.color)}>
                    {log.message}
                  </span>
                </div>
              );
            })
          )}

          {/* Blinking cursor and loading indicator */}
          {isRunning && (
            <div className="flex items-center gap-2 px-1 mt-2 mb-2 text-slate-500 min-h-[24px]">
              <span className="text-xs pt-0.5 w-16" />
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
              <span className="text-xs italic text-slate-400">Processing task...</span>
              <span className="text-emerald-400 animate-pulse">█</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
