"use client";

import { useState } from "react";
import {
  FolderOpen,
  Folder,
  FileCode,
  FileJson,
  FileText,
  File,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/engine-client";

interface FileTreeProps {
  nodes: FileNode[];
  className?: string;
}

const EXTENSION_ICONS: Record<string, React.ElementType> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  json: FileJson,
  md: FileText,
  css: FileCode,
  html: FileCode,
  yaml: FileText,
  yml: FileText,
  sh: FileText,
  env: FileText,
  toml: FileText,
};

function getFileIcon(node: FileNode) {
  if (node.type === "directory") return null;
  const ext = node.extension ?? node.name.split(".").pop() ?? "";
  return EXTENSION_ICONS[ext] ?? File;
}

function formatSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.type === "directory";
  const IconComponent = getFileIcon(node);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer group",
          "hover:bg-slate-700/40 transition-colors",
          "text-sm text-slate-300"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => isDir && setExpanded((x) => !x)}
      >
        {/* Expand chevron */}
        {isDir ? (
          <span className="text-slate-500 w-3 shrink-0">
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Icon */}
        {isDir ? (
          expanded ? (
            <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-400/70 shrink-0" />
          )
        ) : IconComponent ? (
          <IconComponent className="w-4 h-4 text-blue-400 shrink-0" />
        ) : null}

        {/* Name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Size */}
        {!isDir && node.size !== null && (
          <span className="text-slate-600 text-xs shrink-0 ml-1">
            {formatSize(node.size)}
          </span>
        )}
      </div>

      {/* Children */}
      {isDir && expanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ nodes, className }: FileTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-32 text-slate-600 text-sm", className)}>
        No files in workspace yet
      </div>
    );
  }

  return (
    <div className={cn("py-1", className)}>
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} />
      ))}
    </div>
  );
}
