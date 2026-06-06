import React, { useRef, useEffect } from "react";
import ForceGraph3D from "3d-force-graph";

const PAPER = "#f4f1ea";
const INK = "#2b2724";

/* Experimental 3D view of the same graph (three.js via 3d-force-graph).
   Toggled on/off from MusicNetwork; clicking a node propagates the same
   selection used by the 2D map so the detail panel keeps working. */
export default function Graph3D({ graph, gColor, width, height, onNodeClick }) {
  const mountRef = useRef(null);
  const fgRef = useRef(null);

  // Mount once: build the scene from a clone of the graph (3d-force-graph
  // mutates link.source/target into node references).
  useEffect(() => {
    if (!mountRef.current) return;
    const data = {
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({
        source: typeof l.source === "object" ? l.source.id : l.source,
        target: typeof l.target === "object" ? l.target.id : l.target,
        weight: l.weight,
      })),
    };
    const maxDeg = data.nodes.reduce((m, n) => Math.max(m, n.degree || 1), 1);

    const fg = ForceGraph3D()(mountRef.current)
      .backgroundColor(PAPER)
      .width(width)
      .height(height)
      .graphData(data)
      .nodeId("id")
      .nodeLabel((n) => `${n.title} — ${n.artist}`)
      .nodeColor((n) => gColor(n.genre))
      .nodeOpacity(0.95)
      .nodeRelSize(4)
      .nodeVal((n) => 0.6 + ((n.degree || 1) / maxDeg) * 6)
      .linkColor(() => INK)
      .linkOpacity(0.12)
      .linkWidth((l) => Math.min(1.4, 0.2 + (l.weight || 1) * 0.04))
      .enableNodeDrag(false)
      .showNavInfo(false)
      .onNodeClick((n) => {
        // Ease the camera toward the clicked node, then surface the selection.
        const dist = 120;
        const hyp = Math.hypot(n.x || 0, n.y || 0, n.z || 0) || 1;
        const r = 1 + dist / hyp;
        fg.cameraPosition({ x: (n.x || 0) * r, y: (n.y || 0) * r, z: (n.z || 0) * r }, n, 1200);
        onNodeClick && onNodeClick(n);
      });

    fgRef.current = fg;

    return () => {
      try {
        fg._destructor && fg._destructor();
      } catch (e) {
        /* ignore teardown races */
      }
      if (mountRef.current) mountRef.current.innerHTML = "";
      fgRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Keep the renderer sized to its container.
  useEffect(() => {
    if (fgRef.current) fgRef.current.width(width).height(height);
  }, [width, height]);

  return (
    <div
      ref={mountRef}
      style={{ width, height, touchAction: "none", cursor: "grab" }}
    />
  );
}
