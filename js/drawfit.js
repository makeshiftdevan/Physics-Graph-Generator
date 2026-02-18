/**
 * drawfit.js
 * Freehand drawing capture (mouse + touch) and automatic curve fitting.
 *
 * When "Draw Shape" mode is active the canvas captures a freehand path,
 * converts the points to physics coordinates, then fits each candidate
 * relationship type and picks the best match (or splits into segments).
 *
 * Depends on: PG, PG.Graph, PG.Relationships, PG.UI
 */

/* global PG */

PG.DrawFit = (function () {
  'use strict';

  /* ========== state ========== */

  let active = false;          // draw mode is on
  let drawing = false;         // currently tracing (finger/mouse down)
  let rawPoints = [];          // [{ x, y }] in physics coords, sorted by x
  let canvasPoints = [];       // [{ cx, cy }] for rendering the raw stroke
  let canvas = null;

  /* ========== activation ========== */

  function isActive() { return active; }

  function start() {
    active = true;
    drawing = false;
    rawPoints = [];
    canvasPoints = [];
    document.getElementById('drawIdle').classList.add('hidden');
    document.getElementById('drawActive').classList.remove('hidden');
    canvas.style.cursor = 'crosshair';
    updatePointCount();
    PG.Graph.render();
  }

  function cancel() {
    active = false;
    drawing = false;
    rawPoints = [];
    canvasPoints = [];
    document.getElementById('drawActive').classList.add('hidden');
    document.getElementById('drawIdle').classList.remove('hidden');
    canvas.style.cursor = 'crosshair';
    PG.Graph.render();
  }

  function clear() {
    rawPoints = [];
    canvasPoints = [];
    updatePointCount();
    PG.Graph.render();
  }

  function updatePointCount() {
    const el = document.getElementById('drawPointCount');
    if (el) el.textContent = rawPoints.length + ' points';
  }

  /* ========== pointer helpers (unified mouse + touch) ========== */

  function pointerCoords(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return { cx: clientX - rect.left, cy: clientY - rect.top };
  }

  function isInsideGraph(cx, cy) {
    const b = PG.Graph.getGraphBounds();
    return cx >= b.gx && cx <= b.gx + b.gw && cy >= b.gy && cy <= b.gy + b.gh;
  }

  /* ========== event handlers ========== */

  function onPointerDown(e) {
    if (!active) return;
    const { cx, cy } = pointerCoords(e);
    if (!isInsideGraph(cx, cy)) return;

    drawing = true;

    // Start a new stroke (append to existing points so user can draw multiple strokes)
    const px = PG.Graph.toPhysX(cx);
    const py = PG.Graph.toPhysY(cy);
    rawPoints.push({ x: px, y: py });
    canvasPoints.push({ cx, cy });

    e.preventDefault();  // prevent scroll on touch
  }

  function onPointerMove(e) {
    if (!active || !drawing) return;
    const { cx, cy } = pointerCoords(e);
    if (!isInsideGraph(cx, cy)) return;

    const px = PG.Graph.toPhysX(cx);
    const py = PG.Graph.toPhysY(cy);

    // Only add if moved enough (avoid duplicate points)
    const last = canvasPoints[canvasPoints.length - 1];
    if (last && Math.hypot(cx - last.cx, cy - last.cy) < 2) return;

    rawPoints.push({ x: px, y: py });
    canvasPoints.push({ cx, cy });
    updatePointCount();

    PG.Graph.render();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!active) return;
    drawing = false;
    updatePointCount();
  }

  /* ========== rendering (called from graph.js render) ========== */

  function drawOverlay(ctx) {
    if (!active || canvasPoints.length < 2) return;

    ctx.save();

    // Clip to graph area
    const b = PG.Graph.getGraphBounds();
    ctx.beginPath();
    ctx.rect(b.gx - 1, b.gy - 1, b.gw + 2, b.gh + 2);
    ctx.clip();

    // Draw the raw freehand stroke
    ctx.strokeStyle = '#d63031';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(canvasPoints[0].cx, canvasPoints[0].cy);
    for (let i = 1; i < canvasPoints.length; i++) {
      ctx.lineTo(canvasPoints[i].cx, canvasPoints[i].cy);
    }
    ctx.stroke();

    // Draw small dots at endpoints
    ctx.setLineDash([]);
    ctx.fillStyle = '#d63031';
    [canvasPoints[0], canvasPoints[canvasPoints.length - 1]].forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.cx, pt.cy, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  /* ========== curve fitting ========== */

  /**
   * Sort raw points by x and de-duplicate (average y for similar x values).
   * Returns a clean array sorted left-to-right.
   */
  function preparePoints(pts) {
    if (pts.length < 2) return pts.slice();

    // Sort by x
    const sorted = pts.slice().sort((a, b) => a.x - b.x);

    // Bucket nearby x values (within 1% of x-range)
    const xRange = sorted[sorted.length - 1].x - sorted[0].x;
    const bucketSize = Math.max(xRange * 0.005, 1e-9);
    const cleaned = [];
    let bx = sorted[0].x, by = sorted[0].y, bn = 1;

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x - bx / bn < bucketSize) {
        bx += sorted[i].x;
        by += sorted[i].y;
        bn++;
      } else {
        cleaned.push({ x: bx / bn, y: by / bn });
        bx = sorted[i].x;
        by = sorted[i].y;
        bn = 1;
      }
    }
    cleaned.push({ x: bx / bn, y: by / bn });
    return cleaned;
  }

  /**
   * Fit a single relationship type to a set of points.
   * Uses specialized fitting for common types, falls back to fitTo for others.
   * Returns { type, params, mse } where mse = mean squared error.
   */
  function fitSingle(points, relId) {
    const rel = PG.Relationships.get(relId);
    if (!rel || points.length < 2) return { type: relId, params: {}, mse: Infinity };

    const first = points[0];
    const last = points[points.length - 1];
    let bestParams = null;
    let bestMSE = Infinity;

    // Strategy 1: use fitTo with first/last endpoints
    const paramsFitEnds = rel.fitTo(first.x, first.y, last.x, last.y);
    const mseFitEnds = computeMSE(points, rel, paramsFitEnds);
    if (mseFitEnds < bestMSE) { bestMSE = mseFitEnds; bestParams = paramsFitEnds; }

    // Strategy 2: specialized regression for common types
    const specialized = specializedFit(points, relId);
    if (specialized) {
      const mseSpec = computeMSE(points, rel, specialized);
      if (mseSpec < bestMSE) { bestMSE = mseSpec; bestParams = specialized; }
    }

    // Strategy 3: fitTo with quartile points for a second guess
    if (points.length >= 4) {
      const q1 = points[Math.floor(points.length * 0.25)];
      const q3 = points[Math.floor(points.length * 0.75)];
      const paramsQ = rel.fitTo(q1.x, q1.y, q3.x, q3.y);
      const mseQ = computeMSE(points, rel, paramsQ);
      if (mseQ < bestMSE) { bestMSE = mseQ; bestParams = paramsQ; }
    }

    return { type: relId, params: bestParams || rel.defaults, mse: bestMSE };
  }

  function computeMSE(points, rel, params) {
    let sse = 0;
    let valid = 0;
    for (const pt of points) {
      const predicted = rel.fn(pt.x, params);
      if (!isFinite(predicted)) continue;
      sse += (pt.y - predicted) ** 2;
      valid++;
    }
    return valid > 0 ? sse / valid : Infinity;
  }

  /**
   * Specialized least-squares fitting for common types.
   */
  function specializedFit(points, relId) {
    const n = points.length;
    if (n < 2) return null;

    switch (relId) {
      case 'proportional': {
        // y = kx  =>  k = sum(x*y) / sum(x^2)
        let sxy = 0, sxx = 0;
        for (const p of points) { sxy += p.x * p.y; sxx += p.x * p.x; }
        return sxx > 1e-12 ? { k: sxy / sxx } : null;
      }

      case 'linear': {
        // y = mx + b  via standard linear regression
        const reg = linearRegression(points);
        return reg ? { m: reg.m, b: reg.b } : null;
      }

      case 'quadratic': {
        // y = a(x-h)^2 + v  — fit via polynomial regression y = Ax^2 + Bx + C
        const poly = polyRegression2(points);
        if (!poly) return null;
        const { A, B, C } = poly;
        // Convert: a = A, h = -B/(2A), v = C - B^2/(4A)
        if (Math.abs(A) < 1e-12) return null;
        const h = -B / (2 * A);
        const v = C - (B * B) / (4 * A);
        return { a: A, h, v };
      }

      case 'constant': {
        // y = c  =>  c = mean(y)
        let sy = 0;
        for (const p of points) sy += p.y;
        return { c: sy / n };
      }

      case 'sqrt': {
        // y = a*sqrt(x - h) + v  — try h=first.x, v=first.y, fit a
        const h = points[0].x;
        const v = points[0].y;
        let snum = 0, sden = 0;
        for (const p of points) {
          const arg = p.x - h;
          if (arg <= 0) continue;
          const sqrtArg = Math.sqrt(arg);
          snum += (p.y - v) * sqrtArg;
          sden += arg;
        }
        return sden > 1e-12 ? { a: snum / sden, h, v } : null;
      }

      case 'cubic': {
        // y = a(x-h)^3 + v — try h=first.x, v=first.y, then fit a by regression
        const h = points[0].x;
        const v = points[0].y;
        let snum = 0, sden = 0;
        for (const p of points) {
          const dx = p.x - h;
          const dx3 = dx * dx * dx;
          snum += (p.y - v) * dx3;
          sden += dx3 * dx3;
        }
        return sden > 1e-12 ? { a: snum / sden, h, v } : null;
      }

      case 'expGrowth': {
        // y = a*e^(bx) + v — linearize: ln(y) = ln(a) + bx  (only if y > 0)
        const logFit = expFit(points, false);
        return logFit;
      }

      case 'expDecay': {
        // y = a*e^(-bx) + v — similar
        const logFit = expFit(points, true);
        return logFit;
      }

      case 'logarithmic': {
        // y = a*ln(x - h) + v — try h = 0, then linear regression on ln(x)
        const lnPts = [];
        for (const p of points) {
          if (p.x <= 0) continue;
          lnPts.push({ x: Math.log(p.x), y: p.y });
        }
        if (lnPts.length < 2) return null;
        const reg = linearRegression(lnPts);
        return reg ? { a: reg.m, h: 0, v: reg.b } : null;
      }

      default:
        return null;
    }
  }

  /* ---------- regression helpers ---------- */

  function linearRegression(pts) {
    const n = pts.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of pts) {
      sx += p.x; sy += p.y;
      sxy += p.x * p.y;
      sxx += p.x * p.x;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    const m = (n * sxy - sx * sy) / denom;
    const b = (sy - m * sx) / n;
    return { m, b };
  }

  /** Degree-2 polynomial regression: y = Ax^2 + Bx + C */
  function polyRegression2(pts) {
    const n = pts.length;
    if (n < 3) return null;
    // Normal equations for [A, B, C] via sums
    let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let sy = 0, sxy = 0, sx2y = 0;
    for (const p of pts) {
      const x = p.x, x2 = x * x;
      s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
      sy += p.y; sxy += x * p.y; sx2y += x2 * p.y;
    }
    // Solve 3x3 system using Cramer's rule
    //  s4*A + s3*B + s2*C = sx2y
    //  s3*A + s2*B + s1*C = sxy
    //  s2*A + s1*B + s0*C = sy
    const det = s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
    if (Math.abs(det) < 1e-20) return null;
    const A = (sx2y * (s2 * s0 - s1 * s1) - s3 * (sxy * s0 - s1 * sy) + s2 * (sxy * s1 - s2 * sy)) / det;
    const B = (s4 * (sxy * s0 - s1 * sy) - sx2y * (s3 * s0 - s1 * s2) + s2 * (s3 * sy - sxy * s2)) / det;
    const C = (s4 * (s2 * sy - sxy * s1) - s3 * (s3 * sy - sxy * s2) + sx2y * (s3 * s1 - s2 * s2)) / det;
    return { A, B, C };
  }

  /** Fit exponential y = a*e^(+/-b*x) via log-linearization */
  function expFit(pts, isDecay) {
    // Filter to positive-y points for log
    const shifted = [];
    let minY = Infinity;
    for (const p of pts) minY = Math.min(minY, p.y);
    const offset = minY < 0.01 ? Math.abs(minY) + 1 : 0;

    for (const p of pts) {
      const yVal = p.y + offset;
      if (yVal <= 0) continue;
      shifted.push({ x: p.x, y: Math.log(yVal) });
    }
    if (shifted.length < 2) return null;

    const reg = linearRegression(shifted);
    if (!reg) return null;

    // ln(y+offset) = ln(a) + b*x  =>  a = e^(reg.b), b = reg.m
    let a = Math.exp(reg.b);
    let b = Math.abs(reg.m);
    const v = -offset;

    if (isDecay) {
      // y = a*e^(-b*x) + v  — we need b > 0 and slope < 0
      if (reg.m > 0) { a = Math.exp(reg.b + reg.m * pts[pts.length - 1].x); }
      return { a, b, v };
    } else {
      // y = a*e^(b*x) + v
      if (reg.m < 0) b = 0.1; // growth must have positive exponent
      return { a, b, v };
    }
  }

  /* ========== multi-segment fitting ========== */

  /**
   * Fit drawn points into N segments, each with its own best relationship.
   * Returns an array of { xStart, xEnd, type, params }.
   */
  function fitMultiSegment(points, numSegments) {
    if (points.length < 2) return [];
    if (numSegments < 1) numSegments = 1;

    const xMin = points[0].x;
    const xMax = points[points.length - 1].x;
    const segWidth = (xMax - xMin) / numSegments;
    const results = [];

    for (let s = 0; s < numSegments; s++) {
      const x0 = xMin + s * segWidth;
      const x1 = (s === numSegments - 1) ? xMax : xMin + (s + 1) * segWidth;

      // Get points in this x-range
      const segPts = points.filter(p => p.x >= x0 && p.x <= x1);
      if (segPts.length < 2) {
        // Not enough points; use constant at average y
        const avgY = segPts.length > 0 ? segPts[0].y : 0;
        results.push({ xStart: x0, xEnd: x1, type: 'constant', params: { c: avgY } });
        continue;
      }

      // Try all relationship types and pick the best
      const best = findBestFit(segPts);
      results.push({ xStart: x0, xEnd: x1, type: best.type, params: best.params });
    }

    return results;
  }

  /**
   * Auto-detect the number of segments by splitting at inflection points
   * or wherever fit quality degrades.
   */
  function fitAuto(points) {
    if (points.length < 2) return [];

    // First try a single-segment fit
    const singleBest = findBestFit(points);
    const yRange = yRangeOf(points);
    const threshold = yRange * yRange * 0.02; // 2% of y-range squared

    if (singleBest.mse < threshold) {
      return [{
        xStart: points[0].x,
        xEnd: points[points.length - 1].x,
        type: singleBest.type,
        params: singleBest.params,
      }];
    }

    // Try 2 segments, then 3 — pick the first that's good enough
    for (let n = 2; n <= 4; n++) {
      const segs = fitMultiSegment(points, n);
      // Check if all segments have good fit
      let allGood = true;
      const segWidth = points.length / n;
      for (let s = 0; s < n; s++) {
        const segPts = points.filter(
          p => p.x >= segs[s].xStart && p.x <= segs[s].xEnd
        );
        if (segPts.length < 2) continue;
        const rel = PG.Relationships.get(segs[s].type);
        const mse = computeMSE(segPts, rel, segs[s].params);
        if (mse > threshold) { allGood = false; break; }
      }
      if (allGood) return segs;
    }

    // Fall back to 3 segments
    return fitMultiSegment(points, 3);
  }

  function yRangeOf(points) {
    let lo = Infinity, hi = -Infinity;
    for (const p of points) {
      if (p.y < lo) lo = p.y;
      if (p.y > hi) hi = p.y;
    }
    return Math.max(hi - lo, 1e-6);
  }

  /**
   * Try every relationship type and return the best fit.
   */
  function findBestFit(points) {
    let best = { type: 'linear', params: {}, mse: Infinity };
    for (const relId of PG.Relationships.order) {
      const result = fitSingle(points, relId);
      if (result.mse < best.mse) {
        best = result;
      }
    }
    return best;
  }

  /* ========== apply to graph ========== */

  function fitAndApply() {
    if (rawPoints.length < 3) {
      alert('Please draw a shape first (at least a short stroke).');
      return;
    }

    const points = preparePoints(rawPoints);
    if (points.length < 2) {
      alert('Not enough distinct points. Try drawing a longer stroke.');
      return;
    }

    const segCountSel = document.getElementById('drawSegCount').value;
    let fitted;

    if (segCountSel === 'auto') {
      fitted = fitAuto(points);
    } else {
      const n = parseInt(segCountSel, 10);
      fitted = fitMultiSegment(points, n);
    }

    if (fitted.length === 0) {
      alert('Could not fit the drawn shape.');
      return;
    }

    // Replace current segments with fitted result
    PG.state.segments = fitted;
    PG.state.selectedSegment = null;

    // Exit draw mode
    cancel();

    PG.UI.refreshSegmentList();
    PG.Graph.render();
  }

  /* ========== init ========== */

  function init(canvasEl) {
    canvas = canvasEl;

    // Mouse events
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mouseup', onPointerUp);

    // Touch events
    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    canvas.addEventListener('touchmove', onPointerMove, { passive: false });
    canvas.addEventListener('touchend', onPointerUp, { passive: false });
    canvas.addEventListener('touchcancel', onPointerUp, { passive: false });

    // UI buttons
    document.getElementById('btnStartDraw').addEventListener('click', start);
    document.getElementById('btnClearDraw').addEventListener('click', clear);
    document.getElementById('btnFitDraw').addEventListener('click', fitAndApply);
    document.getElementById('btnCancelDraw').addEventListener('click', cancel);
  }

  /* ========== public ========== */

  return {
    init,
    isActive,
    drawOverlay,
    start,
    cancel,
  };
})();
