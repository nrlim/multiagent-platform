"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, FolderClosed, FileCode, FileText, File,
  RefreshCw, Download, ChevronRight, ChevronDown,
  Search, Copy, Check, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import { getSessionWorkspace, type FileNode } from "@/lib/engine-client";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// @ts-ignore
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

function getLanguage(ext?: string | null) {
  if (!ext) return "text";
  const e = ext.toLowerCase();
  if (e === "js" || e === "jsx") return "javascript";
  if (e === "ts" || e === "tsx") return "typescript";
  if (e === "py") return "python";
  if (e === "md") return "markdown";
  if (e === "json") return "json";
  if (e === "yaml" || e === "yml") return "yaml";
  if (e === "html" || e === "htm") return "html";
  if (e === "css") return "css";
  if (e === "sh") return "bash";
  return e;
}

// ─── File icon by extension ───────────────────────────────────────────────────
function getFileIcon(ext?: string | null) {
  const code = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cpp", ".c", ".cs", ".rb", ".php"];
  const text = [".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".env", ".csv"];
  if (!ext) return File;
  if (code.some(e => ext.endsWith(e))) return FileCode;
  if (text.some(e => ext.endsWith(e))) return FileText;
  return File;
}

const EXT_COLORS: Record<string, string> = {
  ".ts":  "text-blue-400",  ".tsx": "text-blue-400",
  ".js":  "text-yellow-400",".jsx": "text-yellow-400",
  ".py":  "text-green-400",
  ".go":  "text-cyan-400",
  ".rs":  "text-orange-400",
  ".md":  "text-slate-400",
  ".json":"text-amber-400",
  ".yaml":"text-purple-400", ".yml": "text-purple-400",
};

// ─── File Tree Node ───────────────────────────────────────────────────────────
function FileTreeNode({
  node, depth = 0, recentPaths, onSelect, selectedPath,
}: {
  node: FileNode; depth?: number;
  recentPaths: Set<string>;
  onSelect: (node: FileNode) => void;
  selectedPath: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isDir  = node.type === "directory";
  const isRecent = recentPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const ext = node.extension;
  const FileIcon = getFileIcon(ext);
  const extColor = ext ? (EXT_COLORS[ext] ?? "text-slate-500") : "text-slate-500";

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className="w-full flex items-center gap-1.5 py-1 pr-2 hover:bg-slate-800/50 rounded-md text-left transition-colors group"
        >
          {open
            ? <ChevronDown className="w-3 h-3 text-slate-600 shrink-0" />
            : <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
          }
          {open
            ? <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            : <FolderClosed className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          }
          <span className="text-xs text-slate-300 truncate">{node.name}</span>
        </button>
        <AnimatePresence>
          {open && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              {node.children.map(child => (
                <FileTreeNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  recentPaths={recentPaths}
                  onSelect={onSelect}
                  selectedPath={selectedPath}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node)}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      className={cn(
        "w-full flex items-center gap-1.5 py-1 pr-2 rounded-md text-left transition-colors",
        isSelected
          ? "bg-indigo-950/40 border-l-2 border-indigo-500"
          : isRecent
          ? "hover:bg-slate-800/50 border-l-2 border-emerald-700/50"
          : "hover:bg-slate-800/50 border-l-2 border-transparent",
      )}
    >
      <span className="w-3 h-3 shrink-0" />
      <FileIcon className={cn("w-3.5 h-3.5 shrink-0", extColor)} />
      <span className={cn("text-xs truncate", isSelected ? "text-slate-100" : "text-slate-400")}>
        {node.name}
      </span>
      {isRecent && !isSelected && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
      )}
    </button>
  );
}

// ─── Code Viewer ─────────────────────────────────────────────────────────────
function CodeViewer({ file, hiveId }: { file: FileNode | null; hiveId: string | null }) {
  const [content, setContent]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [copied,  setCopied]    = useState(false);
  const [error,   setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!file || file.type === "directory") { setContent(null); return; }
    setLoading(true); setError(null);
    const params = new URLSearchParams({ path: file.path });
    if (hiveId) params.set("hive_id", hiveId);
    fetch(`/api/engine/workspace/file?${params.toString()}`)
      .then(r => r.ok ? r.text() : Promise.reject(r.statusText))
      .then(text => { setContent(text); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [file, hiveId]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!file) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-700">
        <FileCode className="w-10 h-10" />
        <p className="text-sm">Select a file to view its contents</p>
        <p className="text-xs text-slate-700">Supports syntax highlighting for TypeScript, Python, Go, and more</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* File header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <FileCode className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-medium text-slate-300">{file.path}</span>
          {file.size != null && (
            <span className="text-[10px] text-slate-600">{(file.size / 1024).toFixed(1)} KB</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={!content}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent hover:border-white/5 transition-all disabled:opacity-40"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <a
            href={`/api/engine/workspace/file?path=${encodeURIComponent(file.path)}&download=1`}
            download={file.name}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent hover:border-white/5 transition-all"
          >
            <Download className="w-3 h-3" /> Download
          </a>
        </div>
      </div>

      {/* Code body */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-slate-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-xs">Loading file…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs">{error}</span>
          </div>
        ) : content ? (
          <SyntaxHighlighter
            language={getLanguage(file?.extension)}
            style={vscDarkPlus}
            customStyle={{ 
              margin: 0, 
              padding: '1rem', 
              fontSize: '12px',
              backgroundColor: 'transparent',
            }}
            wrapLines={true}
            wrapLongLines={true}
          >
            {content}
          </SyntaxHighlighter>
        ) : (
          <pre className="p-4 text-[12px] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap break-all">
            Binary or empty file
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  const { hiveId, recentChanges } = useHiveStore();
  const [fileTree,      setFileTree]      = useState<FileNode[]>([]);
  const [selectedFile,  setSelectedFile]  = useState<FileNode | null>(null);
  const [refreshing,    setRefreshing]    = useState(false);
  const [search,        setSearch]        = useState("");

  const recentPaths = new Set(recentChanges.map(c => c.path));

  const refreshFiles = useCallback(async () => {
    if (!hiveId) return;
    setRefreshing(true);
    const tree = await getSessionWorkspace(hiveId).catch(() => []);
    setFileTree(tree);
    setRefreshing(false);
  }, [hiveId]);

  useEffect(() => { refreshFiles(); }, [refreshFiles]);

  // Auto-refresh when recent changes come in
  useEffect(() => {
    if (recentChanges.length > 0) refreshFiles();
  }, [recentChanges, refreshFiles]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-white/5 flex items-center justify-between px-6 py-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Workspace</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {hiveId
              ? `Session: #${hiveId.slice(0, 8)} · ${recentChanges.length} recent changes`
              : "No active session — start a hive to see generated files"}
          </p>
        </div>
        <button
          onClick={refreshFiles}
          disabled={refreshing || !hiveId}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800/60 border border-white/5 text-slate-300 hover:bg-slate-700/60 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </header>

      {/* ── Dual Pane Layout ──────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* File Tree Sidebar */}
        <aside className="w-64 shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-white/5 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find file…"
                className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>
          </div>
          {/* Tree */}
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {!hiveId ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                <FolderClosed className="w-6 h-6" />
                <p className="text-xs text-center">No session active</p>
              </div>
            ) : fileTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-700">
                <RefreshCw className="w-5 h-5" />
                <p className="text-xs">Files will appear when agents generate them</p>
              </div>
            ) : (
              fileTree.map(node => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  recentPaths={recentPaths}
                  onSelect={n => n.type === "file" && setSelectedFile(n)}
                  selectedPath={selectedFile?.path ?? null}
                />
              ))
            )}
          </div>
          {/* Recent changes strip */}
          {recentChanges.length > 0 && (
            <div className="border-t border-white/5 px-3 py-2 shrink-0">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">Recent Changes</p>
              <div className="space-y-0.5">
                {recentChanges.slice(-5).map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className={cn(
                      "text-[9px] font-bold px-1 py-0.5 rounded",
                      c.op === "created"  ? "bg-emerald-950/60 text-emerald-400" :
                      c.op === "modified" ? "bg-indigo-950/60 text-indigo-400" :
                                           "bg-red-950/60 text-red-400"
                    )}>
                      {c.op[0].toUpperCase()}
                    </span>
                    <span className="text-[10px] text-slate-500 truncate font-mono">{c.path.split("/").pop()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Code Viewer */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#080810]">
          <CodeViewer file={selectedFile} hiveId={hiveId} />
        </div>
      </div>
    </div>
  );
}
