/**
 * useSequentialSpawn — Phase 4.3
 *
 * Manages the "chain reaction" spawn sequence for agent nodes.
 * When agents appear in the hive they are visually staged with:
 *   1. A loading shimmer ("preparing") phase (driven by PREPARING_SPAWN events)
 *   2. A staggered 1.5s–2s delay between each node's full reveal
 *   3. Immediate "working" status the moment the node is visible
 *
 * Usage:
 *   const { prepareSet, visibleSet } = useSequentialSpawn(hiveAgents, wsEvents);
 */

import { useEffect, useRef, useState } from "react";
import type { AgentNode } from "./engine-client";
import type { HiveEvent } from "./use-hive-socket";

export interface SpawnState {
  /** Agent IDs currently in shimmer / pre-spawn anticipation mode */
  prepareSet: Set<string>;
  /** Agent IDs that have been fully revealed (past stagger delay) */
  visibleSet: Set<string>;
}

const STAGGER_MS = 1600; // gap between each sequential node reveal

export function useSequentialSpawn(
  agents: AgentNode[],
  wsEvents: HiveEvent[]
): SpawnState {
  const [prepareSet, setPrepareSet] = useState<Set<string>>(new Set());
  const [visibleSet, setVisibleSet] = useState<Set<string>>(new Set());

  // Track which agent ids we've already scheduled to avoid double-timers
  const scheduledRef = useRef<Set<string>>(new Set());
  // Queue helps maintain ordered stagger
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  // ── Handle PREPARING_SPAWN events (shimmer hint from engine) ──────────────
  useEffect(() => {
    const preparingEvents = wsEvents.filter(
      (e) => e.event_type === "PREPARING_SPAWN"
    );
    if (preparingEvents.length === 0) return;

    setPrepareSet((prev) => {
      const next = new Set(prev);
      for (const ev of preparingEvents) {
        if (ev.agent_id && !scheduledRef.current.has(ev.agent_id)) {
          next.add(ev.agent_id);
        }
      }
      return next;
    });
  }, [wsEvents]);

  // ── Handle new agents: enqueue for staggered reveal ───────────────────────
  useEffect(() => {
    const newIds = agents
      .map((a) => a.id)
      .filter(
        (id) =>
          !scheduledRef.current.has(id) && !visibleSet.has(id)
      );

    if (newIds.length === 0) return;

    for (const id of newIds) {
      scheduledRef.current.add(id);
      queueRef.current.push(id);
    }

    processQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  function processQueue() {
    if (processingRef.current) return;

    const next = queueRef.current.shift();
    if (!next) return;

    processingRef.current = true;

    const delay = visibleSet.size === 0 ? 200 : STAGGER_MS;

    setTimeout(() => {
      setVisibleSet((prev) => {
        const s = new Set(prev);
        s.add(next);
        return s;
      });
      setPrepareSet((prev) => {
        const s = new Set(prev);
        s.delete(next);
        return s;
      });

      processingRef.current = false;

      // If more in queue, continue chain
      if (queueRef.current.length > 0) {
        setTimeout(processQueue, STAGGER_MS);
      }
    }, delay);
  }

  // ── Reset on session clear ─────────────────────────────────────────────────
  useEffect(() => {
    if (agents.length === 0) {
      setPrepareSet(new Set());
      setVisibleSet(new Set());
      scheduledRef.current = new Set();
      queueRef.current = [];
      processingRef.current = false;
    }
  }, [agents.length]);

  return { prepareSet, visibleSet };
}
