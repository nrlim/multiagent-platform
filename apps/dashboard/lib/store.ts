/**
 * AgentHive — Global Zustand Store (Phase 4.4)
 * Maintains all real-time state so WebSocket listeners initialized in the root
 * layout keep updating every page regardless of which route is active.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AgentNode, AgentStatus, BucketTask, BucketProgressWithTasks,
  ReviewLog, DesignSpec,
} from "./engine-client";
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
  pendingReview: { summary: string; hive_id?: string } | null;

  // ── Bucket ──────────────────────────────────────────────────────────────────
  bucketTasks: BucketTask[];
  bucketProgress: BucketProgressWithTasks | null;

  // ── Phase 4.3: Sequential Spawn + Task-Node Linking ─────────────────────────
  /** Agent IDs currently showing shimmer pre-spawn anticipation */
  preparingSpawnSet: Set<string>;
  /** Task ID selected in Kanban — linked agent node is highlighted in graph */
  focusedTaskId: string | null;
  /** Momentary pulse flag on the Manager node when a new task is injected */
  managerPulse: boolean;

  // ── Phase 4.4: Quality Gate + UX Research ───────────────────────────────────
  /** All review logs from Code Reviewer agents for this hive session */
  reviewLogs: ReviewLog[];
  /** All design specs produced by UI/UX Researcher agents */
  designSpecs: DesignSpec[];

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

  setPendingReview: (review: { summary: string; hive_id?: string } | null) => void;

  setBucketTasks: (tasks: BucketTask[]) => void;
  setBucketProgress: (progress: BucketProgressWithTasks | null) => void;

  addPreparingSpawn: (agentId: string) => void;
  removePreparingSpawn: (agentId: string) => void;
  setFocusedTaskId: (id: string | null) => void;
  triggerManagerPulse: () => void;

  // Phase 4.4
  addReviewLog: (log: ReviewLog) => void;
  addDesignSpec: (spec: DesignSpec) => void;
  setReviewLogs: (logs: ReviewLog[]) => void;
  setDesignSpecs: (specs: DesignSpec[]) => void;

  clearSession: () => void;
}

export const useHiveStore = create<HiveStore>()(
  persist(
    (set) => ({
      // ── State defaults ──────────────────────────────────────────────────────
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

      preparingSpawnSet: new Set<string>(),
      focusedTaskId: null,
      managerPulse: false,

      reviewLogs: [],
      designSpecs: [],

      // ── Actions ─────────────────────────────────────────────────────────────
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

      addPreparingSpawn: (agentId) =>
        set((s) => ({ preparingSpawnSet: new Set([...s.preparingSpawnSet, agentId]) })),
      removePreparingSpawn: (agentId) =>
        set((s) => {
          const next = new Set(s.preparingSpawnSet);
          next.delete(agentId);
          return { preparingSpawnSet: next };
        }),
      setFocusedTaskId: (id) => set({ focusedTaskId: id }),
      triggerManagerPulse: () => {
        set({ managerPulse: true });
        setTimeout(() => set({ managerPulse: false }), 2200);
      },

      // Phase 4.4
      addReviewLog: (log)   => set((s) => ({ reviewLogs:  [...s.reviewLogs,  log]  })),
      addDesignSpec: (spec) => set((s) => ({ designSpecs: [...s.designSpecs, spec] })),
      setReviewLogs:  (logs)  => set({ reviewLogs: logs }),
      setDesignSpecs: (specs) => set({ designSpecs: specs }),

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
          preparingSpawnSet: new Set<string>(),
          focusedTaskId: null,
          managerPulse: false,
          reviewLogs: [],
          designSpecs: [],
        }),
    }),
    {
      name: "agenthive-session",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        hiveId:        state.hiveId,
        provider:      state.provider,
        budgetLimit:   state.budgetLimit,
        sessionStatus: state.sessionStatus,
        isRunning:     false,
      }),
    }
  )
);
