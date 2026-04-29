"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileEdit, FolderPlus, Trash2, ChevronRight, ChevronDown, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/engine-client";

// ─── Extension → colour ────────────────────────────────────────────────────
const EXT_COLORS: Record<string, string> = {
  ts:   "text-blue-400",   tsx:  "text-blue-400",  js:   "text-yellow-400",
  jsx:  "text-yellow-400", py:   "text-emerald-600",rs:   "text-orange-400",
  go:   "text-cyan-400",   json: "text-amber-600",  yaml: "text-amber-600",
  yml:  "text-amber-600",  md:   "text-slate-700",  css:  "text-pink-400",
  html: "text-orange-400", sql:  "text-violet-400", sh:   "text-green-400",
  env:  "text-rose-400",   txt:  "text-slate-500",
};

function getExtColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_COLORS[ext] ?? "text-slate-500";
}

function formatBytes(b?: number | null): string {
  if (!b) return "";
  if (b < 1024) return `${b}b`;
  return `${(b / 1024).toFixed(1)}k`;
}

// ─── Single tree node ─────────────────────────────────────────────────────────
type DiffOp = "created" | "modified" | "deleted";

interface AnimatedFileNodeProps {
  node: FileNode;
  depth?: number;
  recentPaths: Set<string>;
  diffOps: Record<string, DiffOp>;
}

function AnimatedFileEntry({ node, depth = 0, recentPaths, diffOps }: AnimatedFileNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isDir    = node.type === "directory";
  const isRecent = recentPaths.has(node.path);
  const op       = diffOps[node.path];
  const extColor = getExtColor(node.name);

  const opColors: Record<DiffOp, string> = {
    created:  "text-emerald-600 bg-emerald-50 border-emerald-200",
    modified: "text-amber-600   bg-amber-500/10   border-amber-500/20",
    deleted:  "text-red-600     bg-red-500/10     border-red-500/20",
  };
  const OpIcon: Record<DiffOp, React.ElementType> = {
    created:  FolderPlus,
    modified: FileEdit,
    deleted:  Trash2,
  };

  return (
    <motion.div
      initial={isRecent ? { opacity: 0, x: -8 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      layout
    >
      {/* Row */}
      <div
        className={cn(
          "group flex items-center gap-2 px-3 py-1.5 rounded-xl cursor-pointer transition-all duration-200 text-base",
          "hover:bg-slate-100 hover:shadow-md",
          isRecent && "bg-slate-100/40 ring-1 ring-white/5",
          op && `border border-dashed ${opColors[op]}`,
        )}
        style={{ paddingLeft: `${depth * 18 + 12}px` }}
        onClick={() => isDir && setExpanded((e) => !e)}
      >
        {isDir ? (
          expanded
            ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0 group-hover:text-slate-800 transition-colors" />
            : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 group-hover:text-slate-800 transition-colors" />
        ) : (
          <File className={cn("w-4 h-4 shrink-0 opacity-80", extColor)} />
        )}

        <span className={cn(
          "truncate flex-1 tracking-wide",
          isDir ? "text-slate-800 font-semibold" : `${extColor} font-medium`,
          op === "deleted" && "line-through opacity-50",
        )}>
          {node.name}
        </span>

        {/* Diff badge */}
        {op && (
          <span className={cn("text-[8px] px-1 py-0.5 rounded font-bold uppercase", opColors[op] || opColors.modified)}>
            {op}
            {(() => { const I = OpIcon[op] || FileEdit; return <I className="inline w-2.5 h-2.5 ml-0.5" />; })()}
          </span>
        )}

        {/* File size */}
        {!isDir && node.size && (
          <span className="text-[9px] text-slate-700 font-mono shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatBytes(node.size)}
          </span>
        )}
      </div>

      {/* Children */}
      <AnimatePresence>
        {isDir && expanded && node.children && node.children.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="relative"
          >
            {/* Indent Guide Line */}
            <div 
              className="absolute left-0 top-0 bottom-0 border-l border-slate-200 transition-opacity opacity-0 group-hover:opacity-100" 
              style={{ left: `${depth * 18 + 19}px` }} 
            />
            {node.children.map((child) => (
              <AnimatedFileEntry
                key={child.path}
                node={child}
                depth={depth + 1}
                recentPaths={recentPaths}
                diffOps={diffOps}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface AnimatedFileTreeProps {
  nodes: FileNode[];
  recentChanges?: Array<{ path: string; op: DiffOp }>;
  className?: string;
}

export function AnimatedFileTree({ nodes, recentChanges = [], className }: AnimatedFileTreeProps) {
  const recentPaths = useMemo(
    () => new Set(recentChanges.map((c) => c.path)),
    [recentChanges]
  );

  const diffOps = useMemo(
    () => Object.fromEntries(recentChanges.map((c) => [c.path, c.op])) as Record<string, DiffOp>,
    [recentChanges]
  );

  if (nodes.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-32 text-slate-700 text-xs", className)}>
        No files generated yet
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 p-3 bg-slate-50/40 rounded-2xl border border-slate-200 shadow-inner", className)}>
      <AnimatePresence>
        {nodes.map((node) => (
          <AnimatedFileEntry
            key={node.path}
            node={node}
            recentPaths={recentPaths}
            diffOps={diffOps}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
