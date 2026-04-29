"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, MessageSquare, AlertCircle, X, Brain, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentNode } from "@/lib/engine-client";

const ROLE_COLORS: Record<string, string> = {
  manager:            "bg-violet-600",
  database_architect: "bg-blue-600",
  backend_dev:        "bg-emerald-600",
  frontend_dev:       "bg-orange-500",
  qa_engineer:        "bg-pink-600",
  devops_engineer:    "bg-slate-600",
  tech_writer:        "bg-yellow-500",
};

interface CommandCenterProps {
  agents: AgentNode[];
  isRunning: boolean;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onSendCorrection: (agentId: string, message: string) => void;
  className?: string;
}

export function CommandCenter({
  agents,
  isRunning,
  isPaused,
  onPause,
  onResume,
  onSendCorrection,
  className,
}: CommandCenterProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<{ agentId: string; msg: string; ts: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeAgents = agents.filter((a) =>
    a.status === "working" || a.status === "thinking" || a.status === "idle"
  );

  const handleSend = useCallback(() => {
    if (!selectedAgentId || !message.trim()) return;
    onSendCorrection(selectedAgentId, message.trim());
    setSent((prev) => [
      ...prev,
      { agentId: selectedAgentId, msg: message.trim(), ts: new Date().toLocaleTimeString() },
    ]);
    setMessage("");
    textareaRef.current?.focus();
  }, [selectedAgentId, message, onSendCorrection]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Pause / Resume */}
      {isRunning && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2"
        >
          <button
            onClick={isPaused ? onResume : onPause}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold",
              "border transition-all duration-200",
              isPaused
                ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-700 hover:bg-emerald-600/30"
                : "bg-amber-600/20 border-amber-500/40 text-amber-700 hover:bg-amber-600/30"
            )}
          >
            {isPaused ? (
              <>
                <Play className="w-4 h-4" /> Resume Hive
              </>
            ) : (
              <>
                <Pause className="w-4 h-4" /> Pause Hive
              </>
            )}
          </button>
        </motion.div>
      )}

      {/* Correction input */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <label className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-violet-400" />
          Send Correction Message
        </label>

        {/* Agent picker */}
        <div className="flex flex-wrap gap-1.5">
          {activeAgents.length === 0 ? (
            <span className="text-sm text-slate-600 font-medium">No active agents</span>
          ) : (
            activeAgents.map((agent) => {
              const sel = selectedAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(sel ? "" : agent.id)}
                  className={cn(
                    "flex flex-col p-4 rounded-xl border transition-all text-left",
                    sel
                      ? "bg-slate-100 border-violet-500/50 shadow-lg"
                      : "bg-slate-50 border-slate-200 hover:border-slate-200"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="text-base font-bold text-slate-900 capitalize">{agent.role.replace(/_/g, " ")}</span>
                    <Badge className={cn("text-[10px] h-5 px-2",
                      agent.status === "working" ? "bg-violet-900/50 text-violet-300 border-violet-700/50" :
                      agent.status === "thinking" ? "bg-blue-900/50 text-blue-300 border-blue-700/50" :
                      "bg-slate-100 text-slate-500"
                    )} variant="outline">
                      {agent.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500 font-medium italic">
                    <Brain className="w-4 h-4" />
                    {agent.role.replace(/_/g, " ")}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
            }}
            disabled={!selectedAgentId}
            placeholder={selectedAgentId ? "Type a correction..." : "Select an agent first"}
            className={cn(
              "flex-1 bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-violet-500/50 placeholder:text-slate-700",
              !selectedAgentId && "opacity-50 cursor-not-allowed"
            )}
          />
          <Button
            size="icon"
            className="shrink-0 bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-11 w-11"
            onClick={handleSend}
            disabled={!selectedAgentId || !message.trim()}
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Sent log */}
      <AnimatePresence>
        {sent.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Sent Corrections
            </label>
            {[...sent].reverse().slice(0, 5).map((s, i) => {
              const agent = agents.find((a) => a.id === s.agentId);
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs px-3 py-2 rounded-xl bg-slate-100/40 border border-slate-200"
                >
                  <span className="text-violet-400 font-bold">
                    → {agent?.role.replace(/_/g, " ") ?? "agent"}
                  </span>
                  <span className="text-slate-500 ml-1">{s.ts}</span>
                  <p className="text-slate-500 mt-0.5 line-clamp-1">{s.msg}</p>
                </motion.div>
              );
            })}
          </div>
        )}
      </AnimatePresence>

      {/* Pause notice */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-950/60 border border-amber-700/40"
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <p className="text-sm font-medium text-amber-700">
              Hive is paused. Agents are holding their current state.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
