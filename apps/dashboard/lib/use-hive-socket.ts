/**
 * AgentHive - WebSocket client hook (Phase 3)
 * Connects to the Python engine's /ws/hive/{hiveId} endpoint
 * and dispatches typed HiveEvent objects to registered handlers.
 */
"use client";

import { useEffect, useRef, useCallback, useState } from "react";

// ─── Canonical event types (mirrors Python EventType) ─────────────────────────
export type EventType =
  | "SPAWN"
  | "PREPARING_SPAWN"
  | "STATUS"
  | "THOUGHT"
  | "TOOL_CALL"
  | "SHELL_OUTPUT"
  | "ARTIFACT"
  | "FILE_CHANGE"
  | "REVIEW_LOG"
  | "DESIGN_SPEC"
  | "DONE"
  | "ERROR"
  | "LOG"
  | "CHAT"
  | "BUCKET_UPDATE"
  | "FACTORY_START"
  | "FACTORY_PROGRESS"
  | "FACTORY_DONE"
  // Swarm events
  | "HANDOFF"
  | "SWARM_DONE"
  | "keepalive"
  | "pong";

export interface HiveEvent {
  id: string;
  event_type: EventType;
  hive_id: string;
  agent_id: string;
  parent_id: string | null;
  data: string | Record<string, unknown>;
  timestamp: string;
}

export type WsStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface UseHiveSocketOptions {
  hiveId: string | null;
  onEvent?: (event: HiveEvent) => void;
  onSpawn?: (event: HiveEvent) => void;
  onStatus?: (event: HiveEvent) => void;
  onThought?: (event: HiveEvent) => void;
  onToolCall?: (event: HiveEvent) => void;
  onShellOutput?: (event: HiveEvent) => void;
  onFileChange?: (event: HiveEvent) => void;
  onArtifact?: (event: HiveEvent) => void;
  onReviewLog?: (event: HiveEvent) => void;
  onDesignSpec?: (event: HiveEvent) => void;
  onDone?: (event: HiveEvent) => void;
  onError?: (event: HiveEvent) => void;
  onClear?: () => void;
}

const ENGINE_WS_BASE =
  process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://localhost:8000";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]; // exponential backoff

export function useHiveSocket(options: UseHiveSocketOptions) {
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const unmountedRef = useRef(false);

  // Maintain latest callbacks without triggering effect cycles
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  const dispatch = useCallback((event: HiveEvent) => {
    const c = callbacksRef.current;
    c.onEvent?.(event);
    switch (event.event_type) {
      case "SPAWN":       c.onSpawn?.(event);      break;
      case "STATUS":      c.onStatus?.(event);     break;
      case "THOUGHT":     c.onThought?.(event);    break;
      case "TOOL_CALL":   c.onToolCall?.(event);   break;
      case "SHELL_OUTPUT":c.onShellOutput?.(event);break;
      case "FILE_CHANGE": c.onFileChange?.(event); break;
      case "ARTIFACT":    c.onArtifact?.(event);   break;
      case "REVIEW_LOG":  c.onReviewLog?.(event);  break;
      case "DESIGN_SPEC": c.onDesignSpec?.(event); break;
      case "DONE":        c.onDone?.(event);       break;
      case "ERROR":       c.onError?.(event);      break;
    }
  }, []);

  const connect = useCallback(() => {
    const hiveId = callbacksRef.current.hiveId;
    if (!hiveId || unmountedRef.current) return;

    const url = `${ENGINE_WS_BASE}/ws/hive/${hiveId}`;
    setWsStatus(retryRef.current > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      setWsStatus("connected");
      callbacksRef.current.onClear?.();
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "keepalive" || data.type === "pong") return;
        dispatch(data as HiveEvent);
      } catch { /* malformed */ }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setWsStatus("reconnecting");
      const delay = RECONNECT_DELAYS[Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)];
      retryRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    // Heartbeat every 25s
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 25000);

    ws.addEventListener("close", () => clearInterval(ping));
  }, [dispatch]);

  useEffect(() => {
    unmountedRef.current = false;
    if (options.hiveId) {
      retryRef.current = 0;
      connect();
    }
    return () => {
      unmountedRef.current = true;
      wsRef.current?.close();
      setWsStatus("disconnected");
    };
  }, [options.hiveId, connect]);

  return { wsStatus };
}
