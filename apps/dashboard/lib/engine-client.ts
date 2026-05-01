// Engine API client — proxied through Next.js API routes
const ENGINE_BASE = "/api/engine";

// ─── Phase 5: System Settings ─────────────────────────────────────────────────
export interface SystemSettings {
  provider: string;
  model: string;
  google_key_set: boolean;
  openai_key_set: boolean;
  anthropic_key_set: boolean;
  deepseek_key_set: boolean;
  kimi_key_set: boolean;
  budget_limit: number;
  run_qa: boolean;
  require_review: boolean;
}

export async function fetchSystemSettings(): Promise<SystemSettings> {
  const res = await fetch(`${ENGINE_BASE}/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSystemSettings(data: Partial<SystemSettings & { google_key?: string, openai_key?: string, anthropic_key?: string, deepseek_key?: string, kimi_key?: string }>): Promise<void> {
  const res = await fetch(`${ENGINE_BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update settings");
}

// ─── Shared Types ─────────────────────────────────────────────────────────────
export interface ExecuteRequest {
  prompt: string;
  provider: string;
  model?: string;
}

export interface ExecuteResponse {
  session_id: string;
  status: string;
  message: string;
  provider: string;
  model: string;
}

export interface SessionLog {
  id: string;
  sessionId: string;
  agentId: string;          // NEW: which agent produced this log
  timestamp: string;
  level: string;
  message: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number | null;
  extension?: string | null;
  children?: FileNode[];
}

export interface Session {
  id: string;
  provider: string;
  model: string;
  status: string;
  prompt: string;
  created_at: string;
  completed_at?: string;
  log_count: number;
  prompt_preview: string;
}

// ─── Phase 2: Hive Types ──────────────────────────────────────────────────────
export type AgentStatus = "idle" | "thinking" | "working" | "fixing" | "completed" | "error";

export interface AgentNode {
  id: string;
  role: string;
  session_id: string;
  parent_id: string | null;
  status: AgentStatus;
  specialized_task: string;
  local_context: Record<string, string>;
  children: string[];
  created_at: string;
  completed_at: string | null;
}

export interface HiveExecuteRequest {
  prompt: string;
  provider: string;
  model?: string;
  budget_limit?: number;    // USD kill-switch (default 2.0)
  require_review?: boolean; // human-in-the-loop gate
  run_qa?: boolean;         // run QA gate (default true)
}

export interface HiveExecuteResponse {
  hive_id: string;
  status: string;
  message: string;
  provider: string;
  model: string;
  budget_limit: number;
}

export interface HiveSession {
  id: string;
  provider: string;
  model: string;
  status: string;
  created_at: string;
  completed_at?: string;
  agent_count: number;
  log_count: number;
  prompt_preview: string;
}

// ─── Legacy: Execute Agent ────────────────────────────────────────────────────
export async function executeAgent(req: ExecuteRequest): Promise<ExecuteResponse> {
  const res = await fetch(`${ENGINE_BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Execute failed: ${res.statusText}`);
  return res.json();
}

// ─── Legacy: Stream Session Logs (SSE) ───────────────────────────────────────
export function streamSessionLogs(
  sessionId: string,
  onLog: (log: SessionLog) => void,
  onDone: (status: string) => void,
  onError?: (err: Error) => void
): () => void {
  const evtSource = new EventSource(`${ENGINE_BASE}/sessions/${sessionId}/stream`);

  evtSource.addEventListener("log", (e) => {
    try { onLog(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });

  evtSource.addEventListener("done", (e) => {
    try { onDone(JSON.parse((e as MessageEvent).data).status); } catch { onDone("completed"); }
    evtSource.close();
  });

  evtSource.onerror = () => {
    onError?.(new Error("SSE connection error"));
    evtSource.close();
  };

  return () => evtSource.close();
}

// ─── Phase 2: Hive Execute ────────────────────────────────────────────────────
export async function executeHive(req: HiveExecuteRequest): Promise<HiveExecuteResponse> {
  const res = await fetch(`${ENGINE_BASE}/hive/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Hive execute failed: ${res.statusText}`);
  return res.json();
}

// ─── Phase 2: Stream Hive Logs (SSE) ─────────────────────────────────────────
export function streamHiveLogs(
  hiveId: string,
  onLog: (log: SessionLog) => void,
  onAgentTree: (agents: AgentNode[]) => void,
  onDone: (status: string) => void,
  onError?: (err: Error) => void
): () => void {
  const evtSource = new EventSource(`${ENGINE_BASE}/hive/${hiveId}/stream`);

  evtSource.addEventListener("log", (e) => {
    try { onLog(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });

  evtSource.addEventListener("agent_tree", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data);
      onAgentTree(data.agents ?? []);
    } catch { /* ignore */ }
  });

  evtSource.addEventListener("done", (e) => {
    try { onDone(JSON.parse((e as MessageEvent).data).status); } catch { onDone("completed"); }
    evtSource.close();
  });

  evtSource.onerror = () => {
    onError?.(new Error("SSE connection error"));
    evtSource.close();
  };

  return () => evtSource.close();
}

// ─── Phase 2: Hive List ───────────────────────────────────────────────────────
export async function listHiveSessions(): Promise<HiveSession[]> {
  const res = await fetch(`${ENGINE_BASE}/hive`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.hives ?? [];
}

export async function getHiveAgents(hiveId: string): Promise<AgentNode[]> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/agents`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.agents ?? [];
}

export interface HiveDetail {
  id: string;
  prompt: string;
  provider: string;
  model: string;
  status: string;
  budget_limit: number;
  created_at: string;
  completed_at?: string | null;
  agents: AgentNode[];
  log_count: number;
}

export async function getHiveDetail(hiveId: string): Promise<HiveDetail | null> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}`);
  if (!res.ok) return null;
  return res.json();
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
export async function listSessions(): Promise<Session[]> {
  const res = await fetch(`${ENGINE_BASE}/sessions`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions ?? [];
}

// ─── Workspace ────────────────────────────────────────────────────────────────
export async function getWorkspace(): Promise<FileNode[]> {
  const res = await fetch(`${ENGINE_BASE}/workspace`);
  if (!res.ok) return [];
  const data = await res.json();
  return buildTree(data.entries ?? []);
}

export async function getSessionWorkspace(sessionId: string): Promise<FileNode[]> {
  const res = await fetch(`${ENGINE_BASE}/workspace/${sessionId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return buildTree(data.entries ?? []);
}

export async function renameWorkspaceFile(oldPath: string, newPath: string, hiveId?: string | null): Promise<boolean> {
  const res = await fetch(`${ENGINE_BASE}/workspace/file/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath, hive_id: hiveId }),
  });
  return res.ok;
}

// ─── Providers ────────────────────────────────────────────────────────────────
export async function getProviders() {
  const res = await fetch(`${ENGINE_BASE}/providers`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.providers ?? [];
}

// ─── Phase 5: Budget / Review / Kill ─────────────────────────────────────────
export interface CostInfo {
  hive_id: string;
  provider: string;
  estimated_tokens: number;
  estimated_cost_usd: number;
  is_killed: boolean;
}

export async function getHiveCost(hiveId: string): Promise<CostInfo | null> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/cost`);
  if (!res.ok) return null;
  return res.json();
}

export async function killHiveSession(hiveId: string): Promise<{ killed: boolean }> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/kill`, { method: "POST" });
  if (!res.ok) throw new Error(`Kill failed: ${res.statusText}`);
  return res.json();
}

export async function resolveReview(
  hiveId: string,
  approved: boolean
): Promise<{ resolved: boolean }> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved }),
  });
  if (!res.ok) throw new Error(`Review resolve failed: ${res.statusText}`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTree(flat: FileNode[]): FileNode[] {
  const map = new Map<string, FileNode>();
  const roots: FileNode[] = [];

  for (const node of flat) {
    map.set(node.path, { ...node, children: node.type === "directory" ? [] : undefined });
  }

  for (const node of map.values()) {
    const parts = node.path.split("/");
    if (parts.length <= 1) {
      roots.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = map.get(parentPath);
      if (parent?.children) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  return roots;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 5 — Task Bucket API
// ═══════════════════════════════════════════════════════════════════════════════

export type BucketPriority = "LOW" | "MEDIUM" | "HIGH";
export type BucketStatus   = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";

export type BucketCardType = "STORY" | "TASK" | "BUG";

export interface BucketTask {
  id: string;
  title: string;
  description: string;
  priority: BucketPriority;
  status: BucketStatus;
  card_type: BucketCardType;
  story_id: string | null;
  hive_id: string | null;
  assigned_agent_id: string | null;
  assigned_role: string | null;
  error_log: string | null;
  retry_count: number;
  max_retries: number;
  parent_task_id: string | null;
  created_at: string;
}

export interface BucketProgress {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  progress_pct: number;
  factory_running: boolean;
  factory_hive_id: string | null;
}

export interface BucketProgressWithTasks extends BucketProgress {
  tasks: BucketTask[];
}

export interface BucketStartRequest {
  provider: string;
  model?: string;
  budget_limit?: number;
  run_qa?: boolean;
  stop_on_failure?: boolean;
  /** Pass the current hiveId to reuse the same orchestration session */
  hive_id?: string | null;
}

export interface BucketStartResponse {
  status: "started" | "already_running" | "empty";
  hive_id: string | null;
  message: string;
  provider?: string;
  model?: string;
  budget_limit?: number;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createBucketTask(
  title: string,
  description = "",
  priority: BucketPriority = "MEDIUM",
  card_type: BucketCardType = "TASK",
  story_id?: string | null,
): Promise<BucketTask> {
  const res = await fetch(`${ENGINE_BASE}/bucket/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, priority, card_type, story_id }),
  });
  if (!res.ok) throw new Error(`createBucketTask failed: ${res.statusText}`);
  return res.json();
}

export async function createBucketStory(
  title: string,
  description = "",
  priority: BucketPriority = "MEDIUM",
): Promise<BucketTask> {
  return createBucketTask(title, description, priority, "STORY");
}

export async function createBucketBug(
  title: string,
  description = "",
  story_id?: string | null,
): Promise<BucketTask> {
  return createBucketTask(title, description, "HIGH", "BUG", story_id);
}

export async function listBucketTasks(status?: BucketStatus): Promise<BucketTask[]> {
  const url = status
    ? `${ENGINE_BASE}/bucket/tasks?status=${status}`
    : `${ENGINE_BASE}/bucket/tasks`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks ?? [];
}

export async function updateBucketTask(
  taskId: string,
  patch: { title?: string; description?: string; priority?: BucketPriority }
): Promise<BucketTask | null> {
  const res = await fetch(`${ENGINE_BASE}/bucket/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteBucketTask(taskId: string): Promise<boolean> {
  const res = await fetch(`${ENGINE_BASE}/bucket/tasks/${taskId}`, {
    method: "DELETE",
  });
  return res.ok;
}

// ── Progress ──────────────────────────────────────────────────────────────────

export async function getBucketProgress(): Promise<BucketProgress> {
  const res = await fetch(`${ENGINE_BASE}/bucket/progress`);
  if (!res.ok) {
    return {
      pending: 0, in_progress: 0, completed: 0, failed: 0,
      cancelled: 0, total: 0, progress_pct: 0,
      factory_running: false, factory_hive_id: null,
    };
  }
  return res.json();
}

/**
 * Subscribe to live bucket progress via SSE.
 * Returns a cleanup function to close the stream.
 */
export function streamBucketProgress(
  onProgress: (data: BucketProgressWithTasks) => void,
  onError?: (err: Error) => void
): () => void {
  const src = new EventSource(`${ENGINE_BASE}/bucket/progress/stream`);
  src.addEventListener("progress", (e) => {
    try { onProgress(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  src.onerror = () => {
    onError?.(new Error("Bucket progress SSE error"));
    src.close();
  };
  return () => src.close();
}

// ── Factory Control ──────────────────────────────────────────────────────────

export async function startBucketFactory(req: BucketStartRequest): Promise<BucketStartResponse> {
  const res = await fetch(`${ENGINE_BASE}/bucket/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`startBucketFactory failed: ${res.statusText}`);
  return res.json();
}

export async function stopBucketFactory(): Promise<{ stopped: boolean; hive_id: string }> {
  const res = await fetch(`${ENGINE_BASE}/bucket/factory`, { method: "DELETE" });
  if (res.status === 404) return { stopped: true, hive_id: "" };
  if (!res.ok) throw new Error(`stopBucketFactory failed: ${res.statusText}`);
  return res.json();
}

export async function getFactoryStatus(): Promise<{
  running: boolean;
  hive_id: string | null;
} & BucketProgress> {
  const res = await fetch(`${ENGINE_BASE}/bucket/factory/status`);
  if (!res.ok) throw new Error(`getFactoryStatus failed: ${res.statusText}`);
  return res.json();
}

// ── Business Analyst (Analyze & Plan) ────────────────────────────────────────

export interface AnalyzeRequest {
  requirement: string;
  provider?: string;
  model?: string;
  /** Reuse existing hive session so graph stays alive */
  hive_id?: string | null;
}

export interface AnalyzeResponse {
  hive_id: string;
  status: "analyzing";
  message: string;
  tasks_queued: number;
}

/**
 * Trigger the Business Analyst agent to decompose a requirement into tasks.
 * Tasks are created asynchronously and appear on the Kanban board in real-time.
 * Returns immediately with the hive_id so the dashboard can subscribe to live events.
 */
export async function analyzeRequirement(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  const res = await fetch(`${ENGINE_BASE}/hive/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`analyzeRequirement failed: ${res.statusText}`);
  return res.json();
}

// ── Workspace File Metadata ───────────────────────────────────────────────────

export interface WorkspaceFileMeta {
  path: string;
  size_bytes: number;
  mime_type: string;
  is_directory: boolean;
  agent_id: string | null;
  updated_at: string | null;
}

export interface HiveFilesResponse {
  hive_id: string;
  /** "db" = from PostgreSQL, "disk" = live scan, "none" = no workspace found */
  source: "db" | "disk" | "none";
  files: WorkspaceFileMeta[];
  count: number;
}

/**
 * Fetch workspace file metadata for a hive session.
 * Returns DB-persisted records when available, falls back to a live disk scan.
 */
export async function getHiveFiles(hiveId: string): Promise<HiveFilesResponse> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/files`);
  if (!res.ok) return { hive_id: hiveId, source: "none", files: [], count: 0 };
  return res.json();
}

// ── Workspace Snapshot (JSON blob) ────────────────────────────────────────────

export interface WorkspaceSnapshot {
  hive_id: string;
  /** Full FileNode[] tree, serialised as a JSON string from the DB */
  files_json: string;
  file_count: number;
  updated_at: string | null;
  source: "db" | "none";
}

/**
 * Fetch the workspace snapshot for a given session.
 * The engine returns the full FileNode[] tree as a JSON string.
 */
export async function getWorkspaceSnapshot(hiveId: string): Promise<WorkspaceSnapshot> {
  const res = await fetch(`${ENGINE_BASE}/workspace/${hiveId}/snapshot`);
  if (!res.ok) return { hive_id: hiveId, files_json: "[]", file_count: 0, updated_at: null, source: "none" };
  return res.json();
}

/**
 * Persist the workspace file tree snapshot for a given session.
 * Pass the full FileNode[] as a JSON string.
 */
export async function saveWorkspaceSnapshot(hiveId: string, tree: FileNode[]): Promise<void> {
  const res = await fetch(`${ENGINE_BASE}/workspace/${hiveId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files_json: JSON.stringify(tree) }),
  });
  if (!res.ok) throw new Error(`saveWorkspaceSnapshot failed: ${res.statusText}`);
}

/**
 * Parse a files_json string from the DB into a FileNode[] array.
 * Always safe — returns [] on any parse error.
 */
export function parseFilesJson(raw: string): FileNode[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 4.4 — Review Logs & Design Specs
// ═══════════════════════════════════════════════════════════════════════════════

export type ReviewVerdict = "APPROVED" | "REFACTOR_REQUIRED";

export interface ReviewLog {
  task_id: string;
  task_title: string;
  worker_role: string;
  verdict: ReviewVerdict;
  critical_count: number;
  major_count: number;
  minor_count: number;
  summary: string;
  timestamp: string;
  reviewer_agent_id: string;
  report_path: string;
  hive_id?: string;
}

export interface DesignSpec {
  task_id: string;
  task_title: string;
  spec_path: string;
  color_primary: string;
  font: string;
  summary: string;
  timestamp: string;
  agent_id: string;
  hive_id?: string;
}

export async function getHiveReviewLogs(hiveId: string): Promise<ReviewLog[]> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/review-logs`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.logs ?? [];
}

export async function getHiveDesignSpecs(hiveId: string): Promise<DesignSpec[]> {
  const res = await fetch(`${ENGINE_BASE}/hive/${hiveId}/design-specs`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.specs ?? [];
}

export async function getAllReviewLogs(): Promise<ReviewLog[]> {
  const res = await fetch(`${ENGINE_BASE}/review-logs`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.logs ?? [];
}

export async function getAllDesignSpecs(): Promise<DesignSpec[]> {
  const res = await fetch(`${ENGINE_BASE}/design-specs`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.specs ?? [];
}
