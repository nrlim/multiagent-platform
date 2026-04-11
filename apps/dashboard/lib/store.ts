/**
 * AgentHive — Global Zustand Store
 * Maintains all real-time state so WebSocket listeners initialized in the root
 * layout keep updating every page regardless of which route is active.
 */
import { create } from "zustand";
import type { AgentNode, AgentStatus, BucketTask, BucketProgressWithTasks } from "./engine-client";
import type { HiveEvent } from "./use-hive-socket";

// ─── Types ────────────────────────────────────────────────────────────────────
export type SessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "review_requested"
  | "killed";

export interface HiveStore {
  // ── Active session ──────────────────────────────────────────────────────────
  hiveId: string | null;
  sessionStatus: SessionStatus;
  isRunning: boolean;
  isPaused: boolean;
  provider: string;
  budgetLimit: number;
  charCount: number;

  // ── Agents ──────────────────────────────────────────────────────────────────
  hiveAgents: AgentNode[];
  thoughts: Record<string, string>;
  toolCalls: Record<string, string>;

  // ── Events / Logs ───────────────────────────────────────────────────────────
  wsEvents: HiveEvent[];
  shellLines: string[];
  recentChanges: Array<{ path: string; op: "created" | "modified" | "deleted" }>;
  clearTrigger: number;

  // ── Review ──────────────────────────────────────────────────────────────────
  pendingReview: { summary: string } | null;

  // ── Bucket ──────────────────────────────────────────────────────────────────
  bucketTasks: BucketTask[];
  bucketProgress: BucketProgressWithTasks | null;

  // ── Actions ─────────────────────────────────────────────────────────────────
  setHiveId: (id: string | null) => void;
  setSessionStatus: (s: SessionStatus) => void;
  setIsRunning: (v: boolean) => void;
  setIsPaused: (v: boolean) => void;
  setProvider: (p: string) => void;
  setBudgetLimit: (v: number) => void;
  addCharCount: (n: number) => void;

  upsertAgent: (agent: AgentNode) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  setHiveAgents: (agents: AgentNode[]) => void;

  updateThought: (agentId: string, thought: string) => void;
  updateToolCall: (agentId: string, call: string) => void;

  pushWsEvents: (events: HiveEvent[]) => void;
  pushShellLines: (lines: string[]) => void;
  addRecentChange: (change: { path: string; op: "created" | "modified" | "deleted" }) => void;

  setPendingReview: (review: { summary: string } | null) => void;

  setBucketTasks: (tasks: BucketTask[]) => void;
  setBucketProgress: (progress: BucketProgressWithTasks | null) => void;

  clearSession: () => void;
}

export const useHiveStore = create<HiveStore>((set) => ({
  // ── State defaults ──────────────────────────────────────────────────────────
  hiveId: null,
  sessionStatus: "idle",
  isRunning: false,
  isPaused: false,
  provider: "google",
  budgetLimit: 2.0,
  charCount: 0,

  hiveAgents: [],
  thoughts: {},
  toolCalls: {},

  wsEvents: [],
  shellLines: [],
  recentChanges: [],
  clearTrigger: 0,

  pendingReview: null,

  bucketTasks: [],
  bucketProgress: null,

  // ── Actions ─────────────────────────────────────────────────────────────────
  setHiveId:       (id) => set({ hiveId: id }),
  setSessionStatus:(s)  => set({ sessionStatus: s }),
  setIsRunning:    (v)  => set({ isRunning: v }),
  setIsPaused:     (v)  => set({ isPaused: v }),
  setProvider:     (p)  => set({ provider: p }),
  setBudgetLimit:  (v)  => set({ budgetLimit: v }),
  addCharCount:    (n)  => set((s) => ({ charCount: s.charCount + n })),

  upsertAgent: (agent) =>
    set((s) => {
      const exists = s.hiveAgents.some((a) => a.id === agent.id);
      return {
        hiveAgents: exists
          ? s.hiveAgents.map((a) => (a.id === agent.id ? agent : a))
          : [...s.hiveAgents, agent],
      };
    }),

  updateAgentStatus: (agentId, status) =>
    set((s) => ({
      hiveAgents: s.hiveAgents.map((a) =>
        a.id === agentId ? { ...a, status } : a
      ),
    })),

  setHiveAgents: (agents) => set({ hiveAgents: agents }),

  updateThought:  (id, t)  => set((s) => ({ thoughts:  { ...s.thoughts,  [id]: t  } })),
  updateToolCall: (id, tc) => set((s) => ({ toolCalls: { ...s.toolCalls, [id]: tc } })),

  pushWsEvents: (events) =>
    set((s) => {
      const ids = new Set(s.wsEvents.map((e) => e.id));
      const next = [...s.wsEvents, ...events.filter((e) => !ids.has(e.id))];
      return { wsEvents: next.length > 500 ? next.slice(-500) : next };
    }),

  pushShellLines: (lines) =>
    set((s) => ({ shellLines: [...s.shellLines, ...lines] })),

  addRecentChange: (change) =>
    set((s) => ({ recentChanges: [...s.recentChanges.slice(-49), change] })),

  setPendingReview: (review) => set({ pendingReview: review }),

  setBucketTasks:    (tasks)    => set({ bucketTasks: tasks }),
  setBucketProgress: (progress) => set({ bucketProgress: progress }),

  clearSession: () =>
    set({
      wsEvents: [],
      shellLines: [],
      recentChanges: [],
      thoughts: {},
      toolCalls: {},
      clearTrigger: Date.now(),
      charCount: 0,
      pendingReview: null,
    }),
}));
