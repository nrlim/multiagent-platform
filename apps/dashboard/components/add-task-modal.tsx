"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BucketPriority } from "@/lib/engine-client";

const PRIORITY_CFG: Record<BucketPriority, { label: string; cls: string; dot: string }> = {
  HIGH:   { label: "High",   cls: "bg-rose-950/60 text-rose-300 border-rose-800/40",   dot: "bg-rose-400" },
  MEDIUM: { label: "Medium", cls: "bg-amber-950/60 text-amber-300 border-amber-800/40", dot: "bg-amber-400" },
  LOW:    { label: "Low",    cls: "bg-slate-800/60 text-slate-400 border-slate-700/40", dot: "bg-slate-500" },
};

interface AddTaskModalProps {
  onAdd: (title: string, desc: string, priority: BucketPriority) => Promise<void>;
  onClose: () => void;
}

export function AddTaskModal({ onAdd, onClose }: AddTaskModalProps) {
  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [priority, setPriority] = useState<BucketPriority>("MEDIUM");
  const [loading,  setLoading]  = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    await onAdd(title.trim(), desc.trim(), priority);
    setLoading(false);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center cmd-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="glass-panel rounded-2xl w-full max-w-md mx-4 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center">
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Add Task to Backlog</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">
              Task Title *
            </label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Implement user authentication API"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700/60 text-sm text-slate-100 placeholder-slate-600
                focus:outline-none focus:ring-1 focus:ring-indigo-500/60 focus:border-indigo-500/40 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">
              Description
              <span className="ml-1 text-slate-600 font-normal normal-case">— optional context or acceptance criteria</span>
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Describe what needs to be done, expected outputs, or constraints..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700/60 text-sm text-slate-100 placeholder-slate-600
                focus:outline-none focus:ring-1 focus:ring-indigo-500/60 focus:border-indigo-500/40 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">Priority</label>
            <div className="flex gap-2">
              {(["LOW", "MEDIUM", "HIGH"] as BucketPriority[]).map((p) => {
                const cfg = PRIORITY_CFG[p];
                const sel = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-all",
                      sel
                        ? cfg.cls + " ring-1 ring-inset ring-current/20"
                        : "bg-slate-800/40 text-slate-600 border-slate-700/40 hover:border-slate-600"
                    )}
                  >
                    <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold border border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || loading}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {loading ? "Adding…" : "Add to Backlog"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
