/**
 * editor.js
 * Interactive graph editing: click to select segments, drag to highlight
 * a region and override its relationship type.
 *
 * Depends on: PG, PG.Graph, PG.Relationships
 */

/* global PG */

PG.Editor = (function () {
  'use strict';

  let canvas;
  let isDragging = false;
  let dragStartX = null;   // physics-x where drag started
  let dragCurrentX = null;  // current physics-x during drag
  let highlightRange = null;  // { x0, x1 } or null

  /* ---------- helpers ---------- */

  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  }

  function isInsideGraph(cx, cy) {
    const b = PG.Graph.getGraphBounds();
    return cx >= b.gx && cx <= b.gx + b.gw && cy >= b.gy && cy <= b.gy + b.gh;
  }

  /** Find which segment index covers physics x, or -1 */
  function segmentAt(px) {
    const segs = PG.state.segments;
    for (let i = 0; i < segs.length; i++) {
      if (px >= segs[i].xStart && px <= segs[i].xEnd) return i;
    }
    return -1;
  }

  /* ---------- mouse handlers ---------- */

  function onMouseDown(e) {
    const { cx, cy } = canvasCoords(e);
    if (!isInsideGraph(cx, cy)) return;

    const px = PG.Graph.toPhysX(cx);
    isDragging = true;
    dragStartX = px;
    dragCurrentX = px;
    highlightRange = null;

    // Immediately select the segment under cursor
    const idx = segmentAt(px);
    if (idx >= 0) {
      PG.state.selectedSegment = idx;
      PG.UI.refreshSegmentList();
    }
  }

  function onMouseMove(e) {
    const { cx, cy } = canvasCoords(e);

    // Tooltip
    if (isInsideGraph(cx, cy) && PG.state.mode === 'quantitative') {
      const px = PG.Graph.toPhysX(cx);
      const py = PG.Graph.toPhysY(cy);
      showTooltip(e.clientX, e.clientY, px, py);
    } else {
      hideTooltip();
    }

    if (!isDragging) return;

    const px = PG.Graph.toPhysX(cx);
    dragCurrentX = Math.max(0, Math.min(PG.state.maxX, px));

    // Only show highlight if dragged a meaningful distance
    const dist = Math.abs(dragCurrentX - dragStartX);
    if (dist > PG.state.maxX * 0.02) {
      highlightRange = {
        x0: Math.min(dragStartX, dragCurrentX),
        x1: Math.max(dragStartX, dragCurrentX),
      };
    }

    PG.Graph.render();
  }

  function onMouseUp(e) {
    if (!isDragging) return;
    isDragging = false;

    if (highlightRange && (highlightRange.x1 - highlightRange.x0) > PG.state.maxX * 0.02) {
      showEditOverlay(e.clientX, e.clientY);
    } else {
      highlightRange = null;
      PG.Graph.render();
    }
  }

  /* ---------- tooltip ---------- */

  function showTooltip(clientX, clientY, px, py) {
    const tip = document.getElementById('tooltip');
    const graphArea = document.querySelector('.graph-area');
    const rect = graphArea.getBoundingClientRect();
    tip.classList.remove('hidden');
    tip.textContent = `(${px.toFixed(2)}, ${py.toFixed(2)})`;
    tip.style.left = (clientX - rect.left + 14) + 'px';
    tip.style.top = (clientY - rect.top - 24) + 'px';
  }

  function hideTooltip() {
    document.getElementById('tooltip').classList.add('hidden');
  }

  /* ---------- edit overlay ---------- */

  function showEditOverlay(clientX, clientY) {
    const overlay = document.getElementById('editOverlay');
    const select = document.getElementById('editOverlaySelect');
    const text = document.getElementById('editOverlayText');

    // Populate select
    select.innerHTML = '';
    PG.Relationships.list().forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.label;
      select.appendChild(opt);
    });

    text.textContent = `x: [${highlightRange.x0.toFixed(1)}, ${highlightRange.x1.toFixed(1)}]`;

    // Position
    const graphArea = document.querySelector('.graph-area');
    const rect = graphArea.getBoundingClientRect();
    overlay.style.left = Math.min(clientX - rect.left, rect.width - 300) + 'px';
    overlay.style.top = Math.max(0, clientY - rect.top - 40) + 'px';
    overlay.classList.remove('hidden');
  }

  function applyOverlayEdit() {
    const select = document.getElementById('editOverlaySelect');
    const newType = select.value;

    if (!highlightRange) return;

    const x0 = highlightRange.x0;
    const x1 = highlightRange.x1;

    // Split/insert segments to cover [x0, x1] with the new type
    splitAndReplace(x0, x1, newType);

    // Cleanup
    highlightRange = null;
    document.getElementById('editOverlay').classList.add('hidden');
    PG.UI.refreshSegmentList();
    PG.Graph.render();
  }

  function cancelOverlayEdit() {
    highlightRange = null;
    document.getElementById('editOverlay').classList.add('hidden');
    PG.Graph.render();
  }

  /* ---------- segment splitting ---------- */

  /**
   * Replace the portion of the graph from x0 to x1 with a new relationship.
   * This may split existing segments.
   */
  function splitAndReplace(x0, x1, newType) {
    const segs = PG.state.segments;
    const newSegs = [];
    const rel = PG.Relationships.get(newType);

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];

      // Segment entirely before the range
      if (s.xEnd <= x0) {
        newSegs.push(s);
        continue;
      }
      // Segment entirely after the range
      if (s.xStart >= x1) {
        newSegs.push(s);
        continue;
      }

      // Segment overlaps with [x0, x1]
      // Part before x0
      if (s.xStart < x0) {
        newSegs.push({
          ...s,
          xEnd: x0,
          params: { ...s.params },
        });
      }

      // The replaced part (only add once, from the first overlapping segment)
      if (!newSegs.find(ns => ns._replaced)) {
        // Calculate y-values at boundaries for continuity
        const yAtX0 = evaluateAt(x0);
        const yAtX1 = evaluateAt(x1);
        const params = { ...rel.defaults };
        if (PG.state.continuous) {
          const fitted = rel.fitTo(x0, yAtX0, x1, yAtX1);
          Object.assign(params, fitted);
        }
        newSegs.push({
          xStart: x0,
          xEnd: x1,
          type: newType,
          params,
          _replaced: true,
        });
      }

      // Part after x1
      if (s.xEnd > x1) {
        newSegs.push({
          ...s,
          xStart: x1,
          params: { ...s.params },
        });
      }
    }

    // Clean up _replaced flag
    newSegs.forEach(s => delete s._replaced);

    PG.state.segments = newSegs;
    PG.state.selectedSegment = null;
  }

  /** Evaluate the current graph at physics x */
  function evaluateAt(px) {
    const segs = PG.state.segments;
    for (let i = 0; i < segs.length; i++) {
      if (px >= segs[i].xStart && px <= segs[i].xEnd) {
        const rel = PG.Relationships.get(segs[i].type);
        if (rel) return rel.fn(px, segs[i].params);
      }
    }
    return 0;
  }

  /* ---------- init ---------- */

  function init(canvasEl) {
    canvas = canvasEl;
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', () => {
      hideTooltip();
      if (isDragging) {
        isDragging = false;
        highlightRange = null;
        PG.Graph.render();
      }
    });

    document.getElementById('editOverlayApply').addEventListener('click', applyOverlayEdit);
    document.getElementById('editOverlayCancel').addEventListener('click', cancelOverlayEdit);
  }

  /* ---------- public ---------- */

  return {
    init,
    get highlightRange() { return highlightRange; },
    evaluateAt,
  };
})();
