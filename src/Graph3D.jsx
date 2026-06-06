import React, { useRef, useEffect } from "react";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import SpriteText from "three-spritetext";

const PAPER = "#f4f1ea";
const INK = "#2b2724";

/* Experimental 3D view of the same graph (three.js via 3d-force-graph).
   Mirrors the 2D map's behaviours: search, genre filter, focus on a selected
   node + its neighbours, playlist highlight with an ordered route line, and
   camera reset. Clicking a node propagates the same selection used by the 2D
   map so the detail panel keeps working. */
export default function Graph3D({
  graph,
  gColor,
  width,
  height,
  onSelect,
  selected,
  neighbors,
  matchSet,
  activeGenre,
  playlistIds,
  resetSignal,
}) {
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
    const byId = new Map(data.nodes.map((n) => [n.id, n]));

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
      // Labels live in 3D space next to the node (added on top of the sphere);
      // which ones are shown is decided reactively in the highlight effect.
      .nodeThreeObjectExtend(true)
      .nodeThreeObject(() => false)
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
        fg.cameraPosition({ x: (n.x || 0) * r, y: (n.y || 0) * r, z: (n.z || 0) * r }, n, 1000);
        onSelect && onSelect(n);
      })
      .onBackgroundClick(() => onSelect && onSelect(null));

    // Ordered playlist route — a single line threaded through the playlist
    // nodes in listening order, kept in sync with their positions each tick.
    const routeGeom = new THREE.BufferGeometry();
    const routeMat = new THREE.LineBasicMaterial({ color: 0x2b2724, transparent: true, opacity: 0.6 });
    const routeLine = new THREE.Line(routeGeom, routeMat);
    routeLine.visible = false;
    routeLine.renderOrder = 1;
    fg.scene().add(routeLine);

    const state = { fg, byId, routeGeom, routeLine, routeNodes: [], showRoute: false, maxDeg };

    const updateRoute = () => {
      const ns = state.routeNodes;
      if (!state.showRoute || !ns || ns.length < 2) {
        routeLine.visible = false;
        return;
      }
      const pos = new Float32Array(ns.length * 3);
      ns.forEach((n, i) => {
        pos[i * 3] = n.x || 0;
        pos[i * 3 + 1] = n.y || 0;
        pos[i * 3 + 2] = n.z || 0;
      });
      routeGeom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      routeGeom.attributes.position.needsUpdate = true;
      routeGeom.computeBoundingSphere();
      routeLine.visible = true;
    };
    state.updateRoute = updateRoute;
    fg.onEngineTick(updateRoute);

    fgRef.current = state;

    return () => {
      try {
        fg._destructor && fg._destructor();
      } catch (e) {
        /* ignore teardown races */
      }
      routeGeom.dispose();
      routeMat.dispose();
      if (mountRef.current) mountRef.current.innerHTML = "";
      fgRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Keep the renderer sized to its container.
  useEffect(() => {
    if (fgRef.current) fgRef.current.fg.width(width).height(height);
  }, [width, height]);

  // React to selection / search / genre filter / playlist: re-style the scene
  // the same way the 2D map dims and highlights. Dimmed nodes are hidden so
  // the focused subgraph reads clearly in 3D.
  useEffect(() => {
    const state = fgRef.current;
    if (!state) return;
    const { fg, byId } = state;

    const focusId = selected?.id || null;
    const nbr = focusId ? neighbors?.get(focusId) : null;
    const playlistSet = playlistIds && playlistIds.length ? new Set(playlistIds) : null;

    const dim = (n) => {
      if (matchSet && !matchSet.has(n.id)) return true;
      if (activeGenre && n.genre !== activeGenre) return true;
      if (focusId && n.id !== focusId && !nbr?.has(n.id)) return true;
      if (!focusId && playlistSet && !playlistSet.has(n.id)) return true;
      return false;
    };
    const visible = (n) => n.id === focusId || !dim(n);
    const baseVal = (n) => 0.6 + ((n.degree || 1) / state.maxDeg) * 6;

    // Show the "Title — Artist" label near a node under the same conditions as
    // the 2D map: the focused node + its neighbours, search matches, or the
    // nodes of an active playlist.
    const labelVisible = (n) => {
      if (focusId) return n.id === focusId || !!nbr?.has(n.id);
      if (matchSet) return matchSet.has(n.id);
      if (playlistSet) return playlistSet.has(n.id);
      return false;
    };
    const makeLabel = (n) => {
      if (!labelVisible(n)) return false;
      const sprite = new SpriteText(`${n.title} — ${n.artist}`);
      sprite.color = INK;
      sprite.backgroundColor = "rgba(244,241,234,0.7)";
      sprite.padding = 1.5;
      sprite.borderRadius = 2;
      sprite.fontFace = "Georgia, serif";
      sprite.textHeight = n.id === focusId ? 5 : 4;
      sprite.material.depthWrite = false;
      // Sit the label just above the sphere (radius ≈ cbrt(val) * nodeRelSize).
      const val = n.id === focusId ? baseVal(n) * 2.4 : playlistSet?.has(n.id) ? baseVal(n) * 1.6 : baseVal(n);
      sprite.position.set(0, Math.cbrt(val) * 4 + sprite.textHeight, 0);
      return sprite;
    };

    fg.nodeVisibility((n) => visible(n))
      .nodeVal((n) => {
        const base = baseVal(n);
        if (n.id === focusId) return base * 2.4;
        if (playlistSet?.has(n.id)) return base * 1.6;
        return base;
      })
      .nodeColor((n) => (n.id === focusId ? INK : gColor(n.genre)))
      .nodeThreeObject(makeLabel)
      .linkVisibility((l) => {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        if (focusId) return s === focusId || t === focusId;
        const sn = byId.get(s);
        const tn = byId.get(t);
        return !!sn && !!tn && visible(sn) && visible(tn);
      });

    // Playlist route: shown only when a playlist is active and no node is
    // being inspected (mirrors the 2D behaviour).
    const ordered = (playlistIds || []).map((id) => byId.get(id)).filter(Boolean);
    state.routeNodes = ordered;
    state.showRoute = !focusId && ordered.length > 1;
    state.updateRoute();

    // Frame the playlist when one was just generated.
    if (!focusId && playlistSet && ordered.length > 1) {
      try {
        fg.zoomToFit(700, 40, (n) => playlistSet.has(n.id));
      } catch (e) {
        /* positions not ready yet — the next interaction will reframe */
      }
    }
  }, [selected, neighbors, matchSet, activeGenre, playlistIds, gColor]);

  // Reset: recenter the camera on the whole graph.
  useEffect(() => {
    const state = fgRef.current;
    if (!state || !resetSignal) return;
    try {
      state.fg.zoomToFit(600, 30);
    } catch (e) {
      /* ignore */
    }
  }, [resetSignal]);

  return (
    <div
      ref={mountRef}
      style={{ width, height, touchAction: "none", cursor: "grab" }}
    />
  );
}
