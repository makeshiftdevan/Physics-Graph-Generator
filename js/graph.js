/**
 * graph.js
 * Canvas-based graph renderer for Quadrants I & IV.
 *
 * Depends on: PG (global), PG.Relationships
 */

/* global PG */

PG.Graph = (function () {
  'use strict';

  /* ========== state ========== */
  let canvas, ctx;
  let W, H;  // canvas pixel dimensions

  // Margins (pixels)
  const M = { top: 40, right: 30, bottom: 50, left: 60 };

  // Graph drawing region (computed)
  let gx, gy, gw, gh; // graph origin-x, origin-y, width, height

  // Colors for segments (cycle)
  const COLORS = [
    '#0984e3', '#d63031', '#00b894', '#e17055',
    '#6c5ce7', '#fdcb6e', '#00cec9', '#e84393',
    '#2d3436', '#55efc4',
  ];

  /* ========== coordinate transforms ========== */

  function toCanvasX(px) {
    const maxX = PG.state.maxX;
    return gx + (px / maxX) * gw;
  }

  function toCanvasY(py) {
    const { maxY, minY } = PG.state;
    const range = maxY - minY;
    return gy + ((maxY - py) / range) * gh;
  }

  function toPhysX(cx) {
    const maxX = PG.state.maxX;
    return ((cx - gx) / gw) * maxX;
  }

  function toPhysY(cy) {
    const { maxY, minY } = PG.state;
    const range = maxY - minY;
    return maxY - ((cy - gy) / gh) * range;
  }

  /* ========== nice numbers for ticks ========== */

  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range));
    const frac = range / Math.pow(10, exp);
    let nice;
    if (round) {
      if (frac < 1.5) nice = 1;
      else if (frac < 3) nice = 2;
      else if (frac < 7) nice = 5;
      else nice = 10;
    } else {
      if (frac <= 1) nice = 1;
      else if (frac <= 2) nice = 2;
      else if (frac <= 5) nice = 5;
      else nice = 10;
    }
    return nice * Math.pow(10, exp);
  }

  function niceTicks(lo, hi, maxTicks) {
    if (hi - lo < 1e-12) return [lo];
    const range = niceNum(hi - lo, false);
    const d = niceNum(range / (maxTicks - 1), true);
    const start = Math.ceil(lo / d) * d;
    const end = Math.floor(hi / d) * d;
    const ticks = [];
    for (let t = start; t <= end + d * 0.5; t += d) {
      ticks.push(parseFloat(t.toPrecision(12)));
    }
    return ticks;
  }

  /* ========== init / resize ========== */

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.floor(rect.width - 32));   // padding
    const h = Math.max(200, Math.floor(rect.height - 32));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w;
    H = h;
    gx = M.left;
    gy = M.top;
    gw = W - M.left - M.right;
    gh = H - M.top - M.bottom;
  }

  /* ========== drawing helpers ========== */

  function clear() {
    ctx.clearRect(0, 0, W, H);
  }

  function drawGrid() {
    if (!PG.state.showGrid) return;
    const { maxX, maxY, minY, mode } = PG.state;

    ctx.save();
    ctx.strokeStyle = '#b2bec3';
    ctx.lineWidth = 0.7;

    if (mode === 'quantitative') {
      // Vertical grid lines
      const xTicks = niceTicks(0, maxX, Math.min(12, Math.floor(gw / 50)));
      xTicks.forEach(t => {
        const cx = toCanvasX(t);
        ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx, gy + gh); ctx.stroke();
      });
      // Horizontal grid lines
      const yTicks = niceTicks(minY, maxY, Math.min(12, Math.floor(gh / 40)));
      yTicks.forEach(t => {
        const cy = toCanvasY(t);
        ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx + gw, cy); ctx.stroke();
      });
    } else {
      // Simple grid for qualitative (evenly spaced)
      const divs = 6;
      for (let i = 1; i < divs; i++) {
        const cx = gx + (i / divs) * gw;
        ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx, gy + gh); ctx.stroke();
        const cy = gy + (i / divs) * gh;
        ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx + gw, cy); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawAxes() {
    const { maxX, maxY, minY, mode, xLabel, yLabel } = PG.state;

    ctx.save();
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#2d3436';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';

    // x-axis position (y = 0)
    const xAxisY = toCanvasY(0);
    const clampedXAxisY = Math.max(gy, Math.min(gy + gh, xAxisY));

    // Y axis (left edge)
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + gh);
    ctx.stroke();

    // X axis (at y=0, clamped to graph area)
    ctx.beginPath();
    ctx.moveTo(gx, clampedXAxisY);
    ctx.lineTo(gx + gw, clampedXAxisY);
    ctx.stroke();

    // Arrowheads
    const aw = 6, ah = 10;
    // Y-axis arrow (top)
    ctx.beginPath();
    ctx.moveTo(gx - aw, gy + ah);
    ctx.lineTo(gx, gy);
    ctx.lineTo(gx + aw, gy + ah);
    ctx.stroke();
    // X-axis arrow (right)
    ctx.beginPath();
    ctx.moveTo(gx + gw - ah, clampedXAxisY - aw);
    ctx.lineTo(gx + gw, clampedXAxisY);
    ctx.lineTo(gx + gw - ah, clampedXAxisY + aw);
    ctx.stroke();

    // Tick marks & labels
    if (mode === 'quantitative') {
      ctx.font = '13px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#2d3436';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // X ticks
      const xTicks = niceTicks(0, maxX, Math.min(12, Math.floor(gw / 50)));
      xTicks.forEach(t => {
        if (t === 0) return;
        const cx = toCanvasX(t);
        ctx.beginPath();
        ctx.moveTo(cx, clampedXAxisY - 4);
        ctx.lineTo(cx, clampedXAxisY + 4);
        ctx.stroke();
        ctx.fillText(formatNum(t), cx, clampedXAxisY + 8);
      });

      // Y ticks
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const yTicks = niceTicks(minY, maxY, Math.min(12, Math.floor(gh / 40)));
      yTicks.forEach(t => {
        if (Math.abs(t) < 1e-10) return; // skip 0
        const cy = toCanvasY(t);
        ctx.beginPath();
        ctx.moveTo(gx - 4, cy);
        ctx.lineTo(gx + 4, cy);
        ctx.stroke();
        ctx.fillText(formatNum(t), gx - 8, cy);
      });

      // Origin label
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('0', gx - 8, clampedXAxisY + 6);
    }

    // Axis labels
    ctx.fillStyle = '#2d3436';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(xLabel, gx + gw / 2, gy + gh + 16);

    ctx.save();
    ctx.translate(16, gy + gh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Quadrant labels (subtle)
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    if (clampedXAxisY > gy + 20) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('I', gx + gw - 6, gy + 4);
    }
    if (clampedXAxisY < gy + gh - 20) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('IV', gx + gw - 6, gy + gh - 4);
    }

    ctx.restore();
  }

  function formatNum(v) {
    if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
      return v.toExponential(1);
    }
    // Remove trailing zeros
    return parseFloat(v.toPrecision(6)).toString();
  }

  /* ========== draw segments (curves) ========== */

  function drawSegments() {
    const { segments, maxX, maxY, minY } = PG.state;
    const steps = Math.max(200, gw);  // one sample per pixel minimum

    segments.forEach((seg, idx) => {
      const rel = PG.Relationships.get(seg.type);
      if (!rel) return;

      const color = COLORS[idx % COLORS.length];
      const isSelected = PG.state.selectedSegment === idx;

      ctx.save();

      // Clipping region for segment x-range
      ctx.beginPath();
      ctx.rect(gx - 1, gy - 1, gw + 2, gh + 2);
      ctx.clip();

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3.5 : 2.5;
      if (isSelected) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }

      ctx.beginPath();
      let started = false;
      const xStart = seg.xStart;
      const xEnd = seg.xEnd;
      const dx = (xEnd - xStart) / steps;

      for (let i = 0; i <= steps; i++) {
        const px = xStart + i * dx;
        const py = rel.fn(px, seg.params);
        if (!isFinite(py) || isNaN(py)) {
          started = false;
          continue;
        }
        // Clamp y to visible range with small buffer for smooth drawing
        const clampedPy = Math.max(minY - (maxY - minY) * 0.05, Math.min(maxY + (maxY - minY) * 0.05, py));
        const cx = toCanvasX(px);
        const cy = toCanvasY(clampedPy);

        if (!started) {
          ctx.moveTo(cx, cy);
          started = true;
        } else {
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();

      // Draw segment boundary markers if more than one segment
      if (segments.length > 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        if (xStart > 0) {
          const bx = toCanvasX(xStart);
          ctx.beginPath();
          ctx.moveTo(bx, gy);
          ctx.lineTo(bx, gy + gh);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      ctx.restore();

      // Segment color indicator in legend area
      if (segments.length > 1) {
        const lx = gx + gw - 10;
        const ly = gy + 14 + idx * 16;
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#636e72';
        ctx.fillText(`Seg ${idx + 1}`, lx - 8, ly);
        ctx.restore();
      }
    });
  }

  /* ========== draw data points ========== */

  function drawDataPoints() {
    const pts = PG.state.dataPoints;
    if (!pts || pts.length === 0) return;
    const { maxX, maxY, minY, mode } = PG.state;

    ctx.save();

    // Clip to graph area
    ctx.beginPath();
    ctx.rect(gx - 1, gy - 1, gw + 2, gh + 2);
    ctx.clip();

    const radius = 5;

    pts.forEach((pt, idx) => {
      const cx = toCanvasX(pt.x);
      const cy = toCanvasY(pt.y);

      // Filled dot
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#e17055';
      ctx.fill();
      ctx.strokeStyle = '#d63031';
      ctx.lineWidth = 1.5;
      ctx.stroke();

    });

    ctx.restore();
  }

  /* ========== highlight region (for editor) ========== */

  function drawHighlight(x0, x1) {
    if (x0 === null || x1 === null) return;
    const cx0 = toCanvasX(Math.min(x0, x1));
    const cx1 = toCanvasX(Math.max(x0, x1));
    ctx.save();
    ctx.fillStyle = 'rgba(9, 132, 227, 0.1)';
    ctx.strokeStyle = 'rgba(9, 132, 227, 0.4)';
    ctx.lineWidth = 1;
    ctx.fillRect(cx0, gy, cx1 - cx0, gh);
    ctx.strokeRect(cx0, gy, cx1 - cx0, gh);
    ctx.restore();
  }

  /* ========== main render ========== */

  function render() {
    resize();
    clear();
    drawGrid();
    drawAxes();
    drawSegments();
    drawDataPoints();
    // Editor highlight
    if (PG.Editor && PG.Editor.highlightRange) {
      const hr = PG.Editor.highlightRange;
      drawHighlight(hr.x0, hr.x1);
    }
    // Freehand draw overlay
    if (PG.DrawFit && PG.DrawFit.isActive()) {
      PG.DrawFit.drawOverlay(ctx);
    }
  }

  /* ========== export ========== */

  function exportPNG() {
    const link = document.createElement('a');
    link.download = 'physics-graph.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  /* ========== public ========== */
  return {
    init,
    render,
    resize,
    toCanvasX, toCanvasY,
    toPhysX, toPhysY,
    exportPNG,
    getGraphBounds: () => ({ gx, gy, gw, gh }),
    COLORS,
  };
})();
