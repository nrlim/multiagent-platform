"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface XtermPanelProps {
  lines: string[];        // new lines to write (append-only)
  className?: string;
  title?: string;
  clearTrigger?: number;
}

// ANSI colour helpers
const ANSI = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
};

function colourLine(line: string): string {
  if (line.startsWith("$"))  return `${ANSI.cyan}${line}${ANSI.reset}`;
  if (line.startsWith("✓") || line.includes("completed") || line.includes("success"))
    return `${ANSI.green}${line}${ANSI.reset}`;
  if (line.startsWith("✗") || line.includes("error") || line.includes("Error") || line.includes("crash"))
    return `${ANSI.red}${line}${ANSI.reset}`;
  if (line.startsWith("⚠") || line.includes("warn") || line.includes("Warn"))
    return `${ANSI.yellow}${line}${ANSI.reset}`;
  if (line.startsWith("⊕") || line.includes("Writing") || line.includes("Created"))
    return `${ANSI.magenta}${line}${ANSI.reset}`;
  return `${ANSI.white}${line}${ANSI.reset}`;
}

export function XtermPanel({ lines, className, title = "shell", clearTrigger = 0 }: XtermPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const lineCountRef = useRef(0);

  // Initialise xterm once
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    let term: import("@xterm/xterm").Terminal;
    let fitAddon: import("@xterm/addon-fit").FitAddon;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");

      term = new Terminal({
        fontSize: 12,
        fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
        theme: {
          background: "#020817",      // slate-950
          foreground: "#cbd5e1",      // slate-300
          cursor: "#818cf8",          // indigo-400
          cursorAccent: "#020817",
          black: "#0f172a",
          brightBlack: "#334155",
          red: "#f87171",
          brightRed: "#fca5a5",
          green: "#4ade80",
          brightGreen: "#86efac",
          yellow: "#facc15",
          brightYellow: "#fde047",
          blue: "#60a5fa",
          brightBlue: "#93c5fd",
          magenta: "#c084fc",
          brightMagenta: "#d8b4fe",
          cyan: "#22d3ee",
          brightCyan: "#67e8f9",
          white: "#cbd5e1",
          brightWhite: "#f1f5f9",
          selectionBackground: "#334155",
        },
        cursorStyle: "block",
        cursorBlink: true,
        scrollback: 5000,
        convertEol: true,
        allowTransparency: true,
        rows: 30,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current!);
      fitAddon.fit();

      termRef.current = term;
      fitRef.current = fitAddon;

      // Welcome banner
      term.writeln(`${ANSI.gray}╔══════════════════════════════════════════╗${ANSI.reset}`);
      term.writeln(`${ANSI.gray}║${ANSI.reset}  ${ANSI.bold}${ANSI.magenta}AgentHive Shell${ANSI.reset}  ${ANSI.gray}— live output stream${ANSI.reset}  ${ANSI.gray}║${ANSI.reset}`);
      term.writeln(`${ANSI.gray}╚══════════════════════════════════════════╝${ANSI.reset}`);
      term.writeln("");
    })();

    const resizeObserver = new ResizeObserver(() => {
      fitRef.current?.fit();
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  // Write new lines incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const newLines = lines.slice(lineCountRef.current);
    lineCountRef.current = lines.length;

    for (const line of newLines) {
      term.writeln(colourLine(line));
    }
  }, [lines]);

  // Handle explicit component clear
  useEffect(() => {
    if (clearTrigger > 0 && termRef.current) {
      termRef.current.clear();
      lineCountRef.current = 0;
    }
  }, [clearTrigger]);

  return (
    <div className={cn("flex flex-col h-full bg-[#020817]", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-700/50 shrink-0">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-amber-500/80" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
        </div>
        <TerminalSquare className="w-3.5 h-3.5 text-slate-500 ml-1" />
        <span className="text-xs text-slate-500 font-mono">{title}</span>
        <span className="ml-auto text-[10px] text-slate-700 font-mono">{lines.length} lines</span>
      </div>

      {/* xterm container */}
      <div className="flex-1 overflow-hidden p-2">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
