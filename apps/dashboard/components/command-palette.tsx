"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Command, LayoutDashboard, FolderOpen,
  BarChart2, Settings, Inbox, Network, ArrowRight,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Command item type ────────────────────────────────────────────────────────
interface CmdItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  group: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (section: string) => void;
}

// ─── Static commands ──────────────────────────────────────────────────────────
function buildCommands(onNavigate: (s: string) => void): CmdItem[] {
  return [
    {
      id: "nav-dashboard",  label: "Go to Dashboard",
      description: "Main command center view", icon: LayoutDashboard,
      group: "Navigate", action: () => onNavigate("dashboard"),
    },
    {
      id: "nav-workspace",  label: "Workspace Files",
      description: "Browse generated files", icon: FolderOpen,
      group: "Navigate", action: () => onNavigate("files"),
    },
    {
      id: "nav-analytics",  label: "Analytics",
      description: "Session & agent performance", icon: BarChart2,
      group: "Navigate", action: () => onNavigate("analytics"),
    },
    {
      id: "nav-settings",   label: "Settings",
      description: "Preferences & API keys", icon: Settings,
      group: "Navigate", action: () => onNavigate("settings"),
    },
    {
      id: "nav-bucket",     label: "Task Bucket",
      description: "Backlog of pending tasks", icon: Inbox,
      group: "Navigate", action: () => onNavigate("bucket"),
    },
    {
      id: "nav-graph",      label: "Agent Graph",
      description: "Live network graph view", icon: Network,
      group: "Navigate", action: () => onNavigate("graph"),
    },
  ];
}

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery]     = useState("");
  const [cursor, setCursor]   = useState(0);
  const inputRef   = useRef<HTMLInputElement>(null);
  const listRef    = useRef<HTMLDivElement>(null);

  const navigate = useCallback((s: string) => {
    onNavigate(s);
    onClose();
  }, [onNavigate, onClose]);

  const commands = buildCommands(navigate);

  const filtered = query.trim()
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  // Group filtered commands
  const groups = filtered.reduce<Record<string, CmdItem[]>>((acc, cmd) => {
    (acc[cmd.group] ??= []).push(cmd);
    return acc;
  }, {});
  const flat = filtered; // flat list for keyboard nav

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  useEffect(() => {
    if (cursor < 0) setCursor(0);
    if (cursor >= flat.length) setCursor(Math.max(0, flat.length - 1));
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, flat.length]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter")     { flat[cursor]?.action(); onClose(); }
    if (e.key === "Escape")    { onClose(); }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[500] flex items-start justify-center pt-[18vh] cmd-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.96, y: -12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: -12 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="glass-panel rounded-2xl w-full max-w-xl mx-4 shadow-2xl shadow-black/60 overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                onKeyDown={handleKey}
                placeholder="Search commands, sections, tasks..."
                className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-600 focus:outline-none"
              />
              <div className="flex items-center gap-1 shrink-0">
                <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">ESC</kbd>
              </div>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-72 overflow-y-auto py-2">
              {flat.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Hash className="w-6 h-6 text-slate-700" />
                  <p className="text-xs text-slate-600">No results for &ldquo;{query}&rdquo;</p>
                </div>
              ) : (
                Object.entries(groups).map(([grp, items]) => {
                  const grpOffset = flat.indexOf(items[0]);
                  return (
                    <div key={grp}>
                      {/* Group label */}
                      <div className="px-4 py-1.5">
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">{grp}</span>
                      </div>
                      {items.map((cmd, localIdx) => {
                        const globalIdx = grpOffset + localIdx;
                        const Icon = cmd.icon;
                        const isActive = cursor === globalIdx;
                        return (
                          <button
                            key={cmd.id}
                            data-idx={globalIdx}
                            onClick={() => { cmd.action(); onClose(); }}
                            onMouseEnter={() => setCursor(globalIdx)}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                              isActive ? "bg-indigo-50" : "hover:bg-slate-100"
                            )}
                          >
                            <div className={cn(
                              "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                              isActive ? "bg-indigo-600/30 text-indigo-700" : "bg-slate-100 text-slate-500"
                            )}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn("text-sm font-medium truncate", isActive ? "text-slate-900" : "text-slate-700")}>
                                {cmd.label}
                              </p>
                              {cmd.description && (
                                <p className="text-[10px] text-slate-600 truncate">{cmd.description}</p>
                              )}
                            </div>
                            {isActive && <ArrowRight className="w-4 h-4 text-indigo-600 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-200 bg-white">
              <div className="flex items-center gap-1 text-[10px] text-slate-600">
                <kbd className="font-mono px-1 py-0.5 rounded bg-slate-100 border border-slate-200">↑↓</kbd>
                Navigate
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-600">
                <kbd className="font-mono px-1 py-0.5 rounded bg-slate-100 border border-slate-200">↵</kbd>
                Select
              </div>
              <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-600">
                <Command className="w-2.5 h-2.5" />K
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
