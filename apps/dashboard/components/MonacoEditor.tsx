"use client";

import { useEffect, useRef, useState } from "react";

// Monaco language map
function getMonacoLang(ext?: string | null): string {
  if (!ext) return "plaintext";
  const e = ext.replace(".", "").toLowerCase();
  const m: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", go: "go", rs: "rust", rb: "ruby", java: "java",
    md: "markdown", json: "json", yaml: "yaml", yml: "yaml",
    html: "html", css: "css", scss: "scss", sh: "shell", bash: "shell",
    sql: "sql", toml: "ini", prisma: "typescript", env: "ini",
    dockerfile: "dockerfile", tf: "hcl", xml: "xml", cs: "csharp",
    cpp: "cpp", c: "c", php: "php", swift: "swift", kt: "kotlin",
  };
  return m[e] ?? "plaintext";
}

interface MonacoEditorProps {
  value: string;
  language?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

declare global {
  interface Window {
    monaco: any;
    __monacoLoading?: boolean;
    __monacoLoaded?: boolean;
    __monacoCallbacks?: Array<() => void>;
  }
}

function loadMonaco(): Promise<void> {
  return new Promise((resolve) => {
    if (window.__monacoLoaded) { resolve(); return; }
    if (!window.__monacoCallbacks) window.__monacoCallbacks = [];
    window.__monacoCallbacks.push(resolve);
    if (window.__monacoLoading) return;
    window.__monacoLoading = true;

    // Load AMD loader
    const loaderScript = document.createElement("script");
    loaderScript.src = "https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.6/require.min.js";
    loaderScript.onload = () => {
      (window as any).require.config({
        paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs" },
      });
      (window as any).require(["vs/editor/editor.main"], () => {
        window.__monacoLoaded = true;
        window.__monacoLoading = false;
        window.__monacoCallbacks?.forEach((cb) => cb());
        window.__monacoCallbacks = [];
      });
    };
    document.head.appendChild(loaderScript);
  });
}

export default function MonacoEditor({
  value,
  language = "plaintext",
  onChange,
  onSave,
  readOnly = false,
  height = "100%",
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const subscriptionRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  // Initialize Monaco
  useEffect(() => {
    let destroyed = false;

    loadMonaco().then(() => {
      if (destroyed || !containerRef.current) return;

      const monaco = window.monaco;

      // Define a custom dark theme matching the app's slate palette
      monaco.editor.defineTheme("agenthive-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6b7a96", fontStyle: "italic" },
          { token: "keyword", foreground: "c792ea" },
          { token: "string", foreground: "c3e88d" },
          { token: "number", foreground: "f78c6c" },
          { token: "type", foreground: "82aaff" },
          { token: "function", foreground: "82aaff" },
          { token: "variable", foreground: "eeffff" },
          { token: "operator", foreground: "89ddff" },
        ],
        colors: {
          "editor.background": "#0d1117",
          "editor.foreground": "#e6edf3",
          "editorLineNumber.foreground": "#3d444d",
          "editorLineNumber.activeForeground": "#6e7681",
          "editor.selectionBackground": "#264f78",
          "editor.lineHighlightBackground": "#161b22",
          "editorCursor.foreground": "#58a6ff",
          "editorIndentGuide.background": "#21262d",
          "editorIndentGuide.activeBackground": "#30363d",
          "editor.findMatchBackground": "#9e6a0340",
          "editor.findMatchHighlightBackground": "#f2cc6040",
          "scrollbarSlider.background": "#30363d80",
          "scrollbarSlider.hoverBackground": "#484f5880",
        },
      });

      const editor = monaco.editor.create(containerRef.current, {
        value,
        language,
        theme: "agenthive-dark",
        readOnly,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        fontLigatures: true,
        lineNumbers: "on",
        minimap: { enabled: true, scale: 1, showSlider: "mouseover" },
        scrollBeyondLastLine: false,
        renderWhitespace: "none",
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        roundedSelection: true,
        padding: { top: 16, bottom: 16 },
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 4,
        folding: true,
        foldingStrategy: "indentation",
        autoIndent: "full",
        formatOnPaste: true,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: "off",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        suggest: { showWords: true },
        quickSuggestions: { other: true, comments: false, strings: false },
        automaticLayout: true,
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontalScrollbarSize: 6,
          useShadows: false,
        },
      });

      editorRef.current = editor;
      setLoading(false);

      // Ctrl+S / Cmd+S to save
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => {
          onSave?.(editor.getValue());
        }
      );

      // On content change
      subscriptionRef.current = editor.onDidChangeModelContent(() => {
        onChange?.(editor.getValue());
      });
    });

    return () => {
      destroyed = true;
      subscriptionRef.current?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync language changes
  useEffect(() => {
    if (!editorRef.current || !window.monaco) return;
    const model = editorRef.current.getModel();
    if (model) window.monaco.editor.setModelLanguage(model, language);
  }, [language]);

  // Sync value from outside (agent writes) — avoid cursor disruption
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = editor.getValue();
    if (current !== value) {
      const pos = editor.getPosition();
      editor.setValue(value);
      if (pos) editor.setPosition(pos);
    }
  }, [value]);

  // Sync readOnly
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  // Sync onSave ref (avoid stale closure)
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  return (
    <div style={{ height, position: "relative" }} className="w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin" />
            <span className="text-[11px] text-slate-500 font-mono">Loading editor…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export { getMonacoLang };
