// ─── Agent Providers ──────────────────────────────────────────────────────────
export type LLMProvider = "google" | "openai" | "anthropic";

// ─── Execute Request/Response ─────────────────────────────────────────────────
export interface ExecuteRequest {
  prompt: string;
  provider: LLMProvider;
  model?: string;
  sessionId?: string;
}

export interface ExecuteResponse {
  sessionId: string;
  status: "started" | "running" | "completed" | "failed";
  message: string;
}

// ─── Log Streaming ────────────────────────────────────────────────────────────
export type LogLevel = "info" | "success" | "warning" | "error" | "command" | "file";

export interface LogEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

// ─── Workspace File Tree ──────────────────────────────────────────────────────
export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
  extension?: string;
}

// ─── Agent Session ────────────────────────────────────────────────────────────
export interface AgentSession {
  id: string;
  provider: LLMProvider;
  model: string;
  prompt: string;
  status: "idle" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  logs: LogEntry[];
}

// ─── Provider Config ──────────────────────────────────────────────────────────
export interface ProviderConfig {
  provider: LLMProvider;
  label: string;
  models: string[];
  defaultModel: string;
  color: string;
  icon: string;
}

export const PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  google: {
    provider: "google",
    label: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-2.5-pro-preview-03-25", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash",
    color: "#4285F4",
    icon: "Sparkles",
  },
  openai: {
    provider: "openai",
    label: "OpenAI GPT",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    defaultModel: "gpt-4o",
    color: "#10A37F",
    icon: "Bot",
  },
  anthropic: {
    provider: "anthropic",
    label: "Anthropic Claude",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
    defaultModel: "claude-sonnet-4-5",
    color: "#D4A574",
    icon: "Brain",
  },
};

export const FILE_EXTENSION_MAP: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  py: "Python",
  json: "JSON",
  md: "Markdown",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  yml: "YAML",
  sh: "Shell",
  env: "Environment",
  toml: "TOML",
};
