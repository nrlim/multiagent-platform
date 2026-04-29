"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "next/navigation";
import {
  FolderOpen, FolderClosed, FileCode, FileText, File, FileCog,
  RefreshCw, Download, ChevronRight, ChevronDown,
  Search, Copy, Check, AlertCircle, Database, HardDrive,
  Layers, Code2, GitBranch, Clock, X, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import {
  getWorkspaceSnapshot, getSessionWorkspace, saveWorkspaceSnapshot,
  parseFilesJson, type FileNode, getHiveFiles,
} from "@/lib/engine-client";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// @ts-ignore
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

// ─── Language / icon helpers ──────────────────────────────────────────────────

function getLang(ext?: string | null) {
  if (!ext) return "text";
  const e = ext.replace(".", "").toLowerCase();
  const m: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", go: "go", rs: "rust", rb: "ruby", java: "java",
    md: "markdown", json: "json", yaml: "yaml", yml: "yaml",
    html: "html", css: "css", sh: "bash", bash: "bash",
    sql: "sql", toml: "toml", prisma: "typescript",
  };
  return m[e] ?? e;
}

const EXT_COLORS: Record<string, string> = {
  ".ts":   "text-sky-600",    ".tsx":  "text-sky-600",
  ".js":   "text-amber-500",  ".jsx":  "text-amber-500",
  ".py":   "text-green-600",
  ".go":   "text-cyan-600",
  ".rs":   "text-orange-600",
  ".md":   "text-slate-500",
  ".json": "text-amber-600",
  ".yaml": "text-purple-600", ".yml":  "text-purple-600",
  ".css":  "text-pink-600",
  ".html": "text-rose-600",
  ".sh":   "text-lime-600",
  ".sql":  "text-emerald-600",
  ".toml": "text-orange-600",
};

const CODE_EXTS = [".ts",".tsx",".js",".jsx",".py",".go",".rs",".java",".cpp",".c",".cs",".rb",".php",".sh",".sql",".prisma"];
const TEXT_EXTS = [".md",".txt",".json",".yaml",".yml",".toml",".env",".csv",".html",".css",".gitignore",".env.example"];

function getExtension(path: string): string | undefined {
  const name = path.split("/").pop() ?? path;
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx) : undefined;
}

function FileIcon({ ext, className }: { ext?: string | null; className?: string }) {
  if (!ext) return <File className={cn("w-3.5 h-3.5 text-slate-500", className)} />;
  if (CODE_EXTS.some(e => ext.endsWith(e))) return <FileCode className={cn("w-3.5 h-3.5", EXT_COLORS[ext] ?? "text-slate-500", className)} />;
  if (TEXT_EXTS.some(e => ext.endsWith(e))) return <FileText className={cn("w-3.5 h-3.5", EXT_COLORS[ext] ?? "text-slate-500", className)} />;
  return <FileCog className={cn("w-3.5 h-3.5 text-slate-500", className)} />;
}

// ─── Flat WorkspaceFileMeta → FileNode tree ───────────────────────────────────

interface FileMeta {
  path: string;
  size_bytes: number;
  mime_type: string;
  is_directory: boolean;
  agent_id: string | null;
  updated_at: string | null;
}

function buildFileTree(files: FileMeta[]): FileNode[] {
  // Sort: directories first, then alphabetically
  const sorted = [...files].sort((a, b) => {
    if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  const nodeMap = new Map<string, FileNode>();
  const roots: FileNode[] = [];

  // Create all nodes
  for (const f of sorted) {
    const name = f.path.split("/").pop() ?? f.path;
    const ext = f.is_directory ? undefined : getExtension(f.path);
    nodeMap.set(f.path, {
      name,
      path: f.path,
      type: f.is_directory ? "directory" : "file",
      size: f.size_bytes,
      extension: ext,
      children: f.is_directory ? [] : undefined,
    });
  }

  // Wire up parent-child relationships
  for (const node of nodeMap.values()) {
    const parts = node.path.split("/");
    if (parts.length <= 1) {
      roots.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = nodeMap.get(parentPath);
      if (parent?.children !== undefined) {
        parent.children!.push(node);
      } else {
        // Parent dir not in list (e.g. engine only saved files, not dirs)
        // Auto-create synthetic parent dir nodes
        let cumPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
          const prev = cumPath;
          cumPath = cumPath ? `${cumPath}/${parts[i]}` : parts[i];
          if (!nodeMap.has(cumPath)) {
            const synth: FileNode = {
              name: parts[i],
              path: cumPath,
              type: "directory",
              children: [],
            };
            nodeMap.set(cumPath, synth);
            if (prev === "") {
              roots.push(synth);
            } else {
              const p = nodeMap.get(prev);
              if (p?.children) p.children.push(synth);
            }
          }
        }
        const parent2 = nodeMap.get(parts.slice(0, -1).join("/"));
        if (parent2?.children !== undefined) {
          parent2.children!.push(node);
        } else {
          roots.push(node);
        }
      }
    }
  }

  return roots;
}

// ─── Flatten tree for search ──────────────────────────────────────────────────

function flattenTree(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children) flattenTree(n.children, out);
  }
  return out;
}

// ─── File Tree Node ───────────────────────────────────────────────────────────

function TreeNode({
  node, depth = 0, selectedPath, recentPaths, expandedDirs, onToggleDir, onSelectFile,
}: {
  node: FileNode;
  depth?: number;
  selectedPath: string | null;
  recentPaths: Set<string>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (node: FileNode) => void;
}) {
  const isDir = node.type === "directory";
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const isRecent = recentPaths.has(node.path);
  const ext = node.extension;

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => onToggleDir(node.path)}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          className="w-full flex items-center gap-1.5 py-[3px] pr-2 hover:bg-slate-100 rounded text-left transition-colors group"
        >
          <span className="w-3 h-3 flex items-center justify-center shrink-0">
            {isExpanded
              ? <ChevronDown className="w-2.5 h-2.5 text-slate-400" />
              : <ChevronRight className="w-2.5 h-2.5 text-slate-400" />}
          </span>
          {isExpanded
            ? <FolderOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            : <FolderClosed className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
          <span className="text-[11px] text-slate-700 group-hover:text-slate-900 truncate transition-colors font-medium">
            {node.name}
          </span>
          {node.children && (
            <span className="ml-auto text-[10px] text-slate-400 shrink-0 font-mono pr-1">
              {node.children.filter(c => c.type === "file").length}
            </span>
          )}
        </button>
        <AnimatePresence>
          {isExpanded && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="relative">
                {/* Indent guide line */}
                <div
                  className="absolute top-0 bottom-0 border-l border-slate-200"
                  style={{ left: `${depth * 12 + 13}px` }}
                />
                {node.children.map(child => (
                  <TreeNode
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    recentPaths={recentPaths}
                    expandedDirs={expandedDirs}
                    onToggleDir={onToggleDir}
                    onSelectFile={onSelectFile}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node)}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      className={cn(
        "w-full flex items-center gap-1.5 py-[3px] pr-2 rounded text-left transition-colors group relative",
        isSelected
          ? "bg-indigo-50 text-indigo-700 font-semibold"
          : "hover:bg-slate-100 text-slate-600 hover:text-slate-900",
      )}
    >
      {isSelected && (
        <span className="absolute left-0 top-0 h-full w-0.5 bg-indigo-500 rounded-full" />
      )}
      <FileIcon ext={ext} />
      <span className={cn("text-[11px] truncate transition-colors", isSelected ? "text-indigo-700" : "text-slate-600 group-hover:text-slate-900")}>
        {node.name}
      </span>
      {isRecent && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" title="Recently modified by agent" />
      )}
    </button>
  );
}

// ─── Open Tabs ────────────────────────────────────────────────────────────────

function TabBar({ tabs, activeTab, onSelect, onClose, modifiedPaths }: {
  tabs: FileNode[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  modifiedPaths: Set<string>;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center border-b border-slate-200 bg-slate-50 overflow-x-auto shrink-0 pt-1.5 px-1">
      {tabs.map(tab => (
        <div
          key={tab.path}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 border border-b-0 cursor-pointer group shrink-0 transition-colors rounded-t-lg mx-0.5 relative top-[1px]",
            activeTab === tab.path
              ? "bg-white border-slate-200 text-slate-900 shadow-[0_-2px_4px_rgba(0,0,0,0.02)] z-10"
              : "bg-slate-100/50 border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800",
          )}
          onClick={() => onSelect(tab.path)}
        >
          <FileIcon ext={tab.extension} />
          <span className="text-xs font-medium">{tab.name}</span>
          {/* Live-modified indicator */}
          {modifiedPaths.has(tab.path) && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" title="Modified by agent" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(tab.path); }}
            className="ml-1 p-0.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-200 transition-all text-slate-400 hover:text-slate-700"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Code Viewer ─────────────────────────────────────────────────────────────

function CodeViewer({
  file, hiveId, refreshTick,
}: {
  file: FileNode | null;
  hiveId: string | null;
  refreshTick: number;  // increment to force reload
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading]  = useState(false);
  const [copied,  setCopied]   = useState(false);
  const [error,   setError]    = useState<string | null>(null);

  useEffect(() => {
    if (!file || file.type === "directory") { setContent(null); return; }
    setLoading(true); setError(null);
    const params = new URLSearchParams({ path: file.path });
    if (hiveId) params.set("hive_id", hiveId);
    fetch(`/api/engine/workspace/file?${params}`)
      .then(r => r.ok ? r.text() : Promise.reject(r.statusText))
      .then(t => { setContent(t); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  // refreshTick is intentionally a dependency so the file reloads on agent writes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path, hiveId, refreshTick]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!file) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-700">
        <Code2 className="w-12 h-12 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-600">Select a file to inspect</p>
          <p className="text-xs text-slate-700 mt-1">Syntax highlighting · auto-refreshes on agent writes</p>
        </div>
      </div>
    );
  }

  const lineCount = content?.split("\n").length ?? 0;
  const ext = file.extension;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon ext={ext} />
          <span className="text-xs font-mono text-slate-500 truncate">{file.path}</span>
          {file.size != null && file.size > 0 && (
            <span className="text-[10px] text-slate-700 shrink-0">{(file.size / 1024).toFixed(1)} KB</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {loading && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-600 mr-2">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" /> syncing…
            </span>
          )}
          {content && (
            <span className="text-[10px] font-mono text-slate-600 mr-2">{lineCount} lines</span>
          )}
          <button
            onClick={handleCopy}
            disabled={!content}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all disabled:opacity-30"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`/api/engine/workspace/file?path=${encodeURIComponent(file.path)}${hiveId ? `&hive_id=${hiveId}` : ""}&download=1`}
            download={file.name}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all"
          >
            <Download className="w-3 h-3" /> Download
          </a>
        </div>
      </div>

      {/* Code body */}
      <div className="flex-1 overflow-auto min-h-0">
        {error ? (
          <div className="flex items-center justify-center h-32 gap-2 text-red-600/80">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs">{error}</span>
          </div>
        ) : content != null ? (
          <SyntaxHighlighter
            language={getLang(ext)}
            style={oneLight}
            customStyle={{ margin: 0, padding: "1.5rem", fontSize: "12px", backgroundColor: "transparent", minHeight: "100%" }}
            showLineNumbers
            lineNumberStyle={{ color: "#94a3b8", minWidth: "2.5em" }}
            wrapLines
            wrapLongLines
          >
            {content}
          </SyntaxHighlighter>
        ) : loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-slate-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-xs">Loading…</span>
          </div>
        ) : (
          <pre className="p-4 text-[12px] font-mono text-slate-500">Binary or empty file</pre>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  const searchParams = useSearchParams();
  const { hiveId: storeHiveId, recentChanges } = useHiveStore();
  const hiveId = searchParams.get("session") ?? storeHiveId;

  const [fileTree,     setFileTree]     = useState<FileNode[]>([]);
  const [source,       setSource]       = useState<"db" | "disk" | "none">("none");
  const [fileCount,    setFileCount]    = useState(0);
  const [updatedAt,    setUpdatedAt]    = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs,     setOpenTabs]     = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [search,       setSearch]       = useState("");
  const [refreshing,   setRefreshing]   = useState(false);

  // refreshTick: increment whenever the active file needs reloading
  const [refreshTick, setRefreshTick]   = useState(0);

  // Track which open tabs have been modified since opened
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(new Set());

  const recentPaths = useMemo(() => new Set(recentChanges.map(c => c.path)), [recentChanges]);

  // ── auto-expand dirs ───────────────────────────────────────────────────────
  const autoExpand = useCallback((nodes: FileNode[]) => {
    const dirs = new Set<string>();
    const walk = (list: FileNode[], depth: number) => {
      for (const n of list) {
        if (n.type === "directory") {
          if (depth < 2) dirs.add(n.path);
          if (n.children) walk(n.children, depth + 1);
        }
      }
    };
    walk(nodes, 0);
    setExpandedDirs(dirs);
  }, []);

  // ── fetch files ────────────────────────────────────────────────────────────
  const refreshFiles = useCallback(async () => {
    if (!hiveId) return;
    setRefreshing(true);
    try {
      // 1. Primary: workspace_files DB table (per-write persistence)
      const hiveFiles = await getHiveFiles(hiveId).catch(() => null);
      if (hiveFiles && hiveFiles.source !== "none" && hiveFiles.files.length > 0) {
        const tree = buildFileTree(hiveFiles.files);
        setFileTree(tree);
        setSource(hiveFiles.source);
        setFileCount(hiveFiles.files.filter(f => !f.is_directory).length);
        setUpdatedAt(
          hiveFiles.files.reduce((latest, f) =>
            f.updated_at && f.updated_at > (latest ?? "") ? f.updated_at : latest,
          null as string | null)
        );
        autoExpand(tree);
        // Save snapshot for history page
        saveWorkspaceSnapshot(hiveId, tree).catch(() => {});
        return;
      }

      // 2. Fallback: snapshot blob from DB
      const snap = await getWorkspaceSnapshot(hiveId);
      if (snap.source === "db" && snap.file_count > 0) {
        const tree = parseFilesJson(snap.files_json);
        setFileTree(tree);
        setSource("db");
        setFileCount(snap.file_count);
        setUpdatedAt(snap.updated_at);
        autoExpand(tree);
        return;
      }

      // 3. Last-resort: live disk scan (recursive now)
      const tree = await getSessionWorkspace(hiveId).catch(() => []);
      setFileTree(tree);
      setSource(tree.length > 0 ? "disk" : "none");
      setFileCount(flattenTree(tree).filter(n => n.type === "file").length);
      setUpdatedAt(null);
      autoExpand(tree);
      if (tree.length > 0) saveWorkspaceSnapshot(hiveId, tree).catch(() => {});
    } finally {
      setRefreshing(false);
    }
  }, [hiveId, autoExpand]);

  useEffect(() => { refreshFiles(); }, [refreshFiles]);

  // ── Re-fetch on FILE_CHANGE events ────────────────────────────────────────
  const prevChangesLen = useRef(0);
  useEffect(() => {
    if (recentChanges.length !== prevChangesLen.current) {
      const newChanges = recentChanges.slice(prevChangesLen.current);
      prevChangesLen.current = recentChanges.length;

      // Mark any open tabs that were just modified
      const changedPaths = new Set(newChanges.map(c => c.path));
      setModifiedPaths(prev => {
        const next = new Set(prev);
        for (const p of changedPaths) next.add(p);
        return next;
      });

      // If the currently open file was modified → force-reload its content
      if (selectedPath && changedPaths.has(selectedPath)) {
        setRefreshTick(t => t + 1);
        // Clear the modified badge for the open file (it's being reloaded)
        setModifiedPaths(prev => {
          const next = new Set(prev);
          next.delete(selectedPath);
          return next;
        });
      }

      // Debounce tree refresh so rapid writes don't spam the API
      const t = setTimeout(refreshFiles, 900);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentChanges]);

  // ── File selection & tabs ─────────────────────────────────────────────────
  const handleSelectFile = useCallback((node: FileNode) => {
    if (node.type === "directory") return;
    setSelectedPath(node.path);
    setRefreshTick(t => t + 1); // always reload on select
    setOpenTabs(prev => {
      if (prev.some(t => t.path === node.path)) return prev;
      return [...prev, node];
    });
    // Clear modified badge when opening file
    setModifiedPaths(prev => {
      const next = new Set(prev);
      next.delete(node.path);
      return next;
    });
  }, []);

  const handleCloseTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      const remaining = prev.filter(t => t.path !== path);
      if (selectedPath === path) {
        setSelectedPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
      }
      return remaining;
    });
  }, [selectedPath]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // ── Search filter ─────────────────────────────────────────────────────────
  const allFiles = useMemo(() => flattenTree(fileTree).filter(n => n.type === "file"), [fileTree]);
  const filtered = useMemo(() =>
    search.trim()
      ? allFiles.filter(n => n.path.toLowerCase().includes(search.toLowerCase()))
      : null,
    [search, allFiles]
  );

  const activeFile = useMemo(() =>
    openTabs.find(t => t.path === selectedPath) ?? null,
    [openTabs, selectedPath]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-slate-200 flex items-center justify-between px-6 py-3.5 shrink-0 z-30 bg-slate-50/50">
        <div>
          <h1 className="text-sm font-semibold text-slate-900 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-indigo-50 border border-indigo-200 flex items-center justify-center">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            Workspace Explorer
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-[11px] text-slate-500">
              {hiveId
                ? `Session #${hiveId.slice(0, 8)}`
                : "No active session — start a Hive run first"}
            </p>
            {source !== "none" && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border uppercase tracking-widest",
                source === "db"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              )}>
                {source === "db" ? <Database className="w-2.5 h-2.5" /> : <HardDrive className="w-2.5 h-2.5" />}
                {source === "db" ? "PostgreSQL" : "Local Disk"}
              </span>
            )}
            {fileCount > 0 && (
              <span className="text-[10px] text-slate-500 font-mono tracking-tight">{fileCount} files</span>
            )}
            {updatedAt && (
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {new Date(updatedAt).toLocaleTimeString()}
              </span>
            )}
            {recentChanges.length > 0 && (
              <motion.span
                key={recentChanges.length}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-flex items-center gap-1 text-[10px] text-indigo-400 font-semibold"
              >
                <Zap className="w-2.5 h-2.5" />
                {recentChanges.length} updates
              </motion.span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="#"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all"
          >
            <GitBranch className="w-3 h-3" /> main
          </a>
          <button
            onClick={refreshFiles}
            disabled={refreshing || !hiveId}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
            Sync
          </button>
        </div>
      </header>

      {/* ── IDE Body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Sidebar — File Tree */}
        <aside className="w-72 shrink-0 border-r border-slate-200 flex flex-col overflow-hidden bg-slate-50/30">
          {/* Search */}
          <div className="px-3 py-2.5 border-b border-slate-200 bg-white/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find file…"
                className="w-full pl-7 pr-3 py-1.5 rounded-md bg-white border border-slate-200 text-[11px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-sm"
              />
            </div>
          </div>

          {/* Explorer label */}
          <div className="px-4 py-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Explorer</span>
            <span className="text-[10px] text-slate-600 font-mono tracking-tight">{allFiles.length} files</span>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto px-1 pb-2 min-h-0 custom-scrollbar">
            {!hiveId ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                <FolderClosed className="w-6 h-6 opacity-40" />
                <p className="text-xs text-center px-2">No session active. Start a Hive run to see files.</p>
              </div>
            ) : refreshing && fileTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                <RefreshCw className="w-4 h-4 opacity-40 animate-spin" />
                <p className="text-[11px] text-center px-2">Scanning workspace…</p>
              </div>
            ) : fileTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                <RefreshCw className="w-4 h-4 opacity-40" />
                <p className="text-[11px] text-center px-2">Files appear as agents generate them</p>
              </div>
            ) : filtered ? (
              // Search results flat list
              filtered.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6">No matches for "{search}"</p>
              ) : (
                filtered.map(n => (
                  <button
                    key={n.path}
                    onClick={() => handleSelectFile(n)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 rounded text-left text-xs transition-colors",
                      selectedPath === n.path
                        ? "bg-indigo-50 text-indigo-700 font-semibold"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <FileIcon ext={n.extension} />
                    <span className="truncate">{n.name}</span>
                    <span className="ml-auto text-[10px] text-slate-400 font-mono truncate">
                      {n.path.split("/").slice(0, -1).join("/")}
                    </span>
                    {recentPaths.has(n.path) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    )}
                  </button>
                ))
              )
            ) : (
              // Full tree
              fileTree.map(node => (
                <TreeNode
                  key={node.path}
                  node={node}
                  selectedPath={selectedPath}
                  recentPaths={recentPaths}
                  expandedDirs={expandedDirs}
                  onToggleDir={toggleDir}
                  onSelectFile={handleSelectFile}
                />
              ))
            )}
          </div>

          {/* Recent Changes Strip */}
          {recentChanges.length > 0 && (
            <div className="border-t border-slate-200 px-3 py-2 shrink-0">
              <p className="text-[9px] uppercase tracking-widest text-slate-700 mb-1.5">Live changes</p>
              {recentChanges.slice(-5).reverse().map((c, i) => (
                <button
                  key={i}
                  onClick={() => {
                    // Try to find the file in the tree and open it
                    const found = allFiles.find(f => f.path === c.path || f.name === c.path.split("/").pop());
                    if (found) handleSelectFile(found);
                  }}
                  className="w-full flex items-center gap-1.5 mb-0.5 hover:bg-slate-100 rounded px-1 py-0.5 transition-colors group"
                >
                  <span className={cn(
                    "text-[9px] font-black px-1 py-0.5 rounded uppercase shrink-0",
                    c.op === "created"  ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                    c.op === "modified" ? "bg-indigo-50 text-indigo-600 border border-indigo-100"   :
                                         "bg-red-50 text-red-600 border border-red-100"
                  )}>{c.op[0]}</span>
                  <span className="text-[10px] text-slate-500 font-mono truncate group-hover:text-slate-800 transition-colors">
                    {c.path.split("/").pop()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Right pane — Tabs + Code Viewer */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TabBar
            tabs={openTabs}
            activeTab={selectedPath}
            onSelect={(path) => {
              setSelectedPath(path);
              setRefreshTick(t => t + 1);
            }}
            onClose={handleCloseTab}
            modifiedPaths={modifiedPaths}
          />
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            <CodeViewer file={activeFile} hiveId={hiveId} refreshTick={refreshTick} />
          </div>
        </div>
      </div>
    </div>
  );
}
