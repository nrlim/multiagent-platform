/**
 * Dagre-based auto-layout for the React Flow agent graph.
 * Returns a map of nodeId → {x, y} suitable for React Flow positions.
 */
import dagre from "@dagrejs/dagre";
import type { AgentNode } from "./engine-client";

export const NODE_WIDTH  = 220;
export const NODE_HEIGHT = 150;

export function computeDagreLayout(
  agents: AgentNode[],
  direction: "TB" | "LR" = "TB"
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  });

  for (const agent of agents) {
    g.setNode(agent.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const agent of agents) {
    if (agent.parent_id) {
      g.setEdge(agent.parent_id, agent.id);
    }
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const agent of agents) {
    const node = g.node(agent.id);
    if (node) {
      positions[agent.id] = {
        x: node.x - NODE_WIDTH / 2,
        y: node.y - NODE_HEIGHT / 2,
      };
    }
  }
  return positions;
}
