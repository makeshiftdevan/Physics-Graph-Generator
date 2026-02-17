/**
 * advanced.js
 * Advanced mode: enter a slope or integral value and auto-generate
 * the appropriate curve for the selected segment.
 *
 * Depends on: PG, PG.Relationships, PG.Editor
 */

/* global PG */

PG.Advanced = (function () {
  'use strict';

  /**
   * Apply a constant slope to the selected segment.
   * This converts the segment to a linear relationship y = slope * (x - x0) + y0
   * where y0 is the y-value at x0 (for continuity).
   */
  function applySlope(segIndex, slope) {
    const seg = PG.state.segments[segIndex];
    if (!seg) return;

    const x0 = seg.xStart;
    let y0 = 0;

    // If continuous mode, get y-value from previous segment endpoint
    if (PG.state.continuous && segIndex > 0) {
      const prevSeg = PG.state.segments[segIndex - 1];
      const prevRel = PG.Relationships.get(prevSeg.type);
      if (prevRel) {
        y0 = prevRel.fn(prevSeg.xEnd, prevSeg.params);
      }
    } else if (PG.state.continuous) {
      y0 = 0; // First segment starts at origin
    }

    // Convert to linear: y = m*x + b, where m = slope, b = y0 - slope * x0
    seg.type = 'linear';
    seg.params = {
      m: slope,
      b: y0 - slope * x0,
    };
  }

  /**
   * Apply a target integral (area under curve) to the selected segment.
   * We determine what constant y-value would give the desired area,
   * then offer smarter options based on the current relationship type.
   */
  function applyIntegral(segIndex, targetArea) {
    const seg = PG.state.segments[segIndex];
    if (!seg) return;

    const x0 = seg.xStart;
    const x1 = seg.xEnd;
    const dx = x1 - x0;

    if (Math.abs(dx) < 1e-12) return;

    let y0 = 0;
    if (PG.state.continuous && segIndex > 0) {
      const prevSeg = PG.state.segments[segIndex - 1];
      const prevRel = PG.Relationships.get(prevSeg.type);
      if (prevRel) {
        y0 = prevRel.fn(prevSeg.xEnd, prevSeg.params);
      }
    }

    const currentType = seg.type;
    const rel = PG.Relationships.get(currentType);

    // Strategy depends on the relationship type
    switch (currentType) {
      case 'constant': {
        // area = c * dx  =>  c = area / dx
        seg.params = { c: targetArea / dx };
        break;
      }

      case 'proportional': {
        // area = k * (x1^2 - x0^2) / 2  =>  k = 2 * area / (x1^2 - x0^2)
        const denom = x1 * x1 - x0 * x0;
        if (Math.abs(denom) < 1e-12) {
          seg.params = { k: 0 };
        } else {
          seg.params = { k: 2 * targetArea / denom };
        }
        break;
      }

      case 'linear': {
        // integral = m*(x1^2-x0^2)/2 + b*(x1-x0)
        // With continuity: b = y0 - m*x0
        // integral = m*(x1^2-x0^2)/2 + (y0 - m*x0)*(x1-x0)
        //          = m * [(x1^2-x0^2)/2 - x0*(x1-x0)] + y0*(x1-x0)
        //          = m * [(x1-x0)*(x1+x0)/2 - x0*(x1-x0)] + y0*dx
        //          = m * (x1-x0)*[(x1+x0)/2 - x0] + y0*dx
        //          = m * dx * (x1-x0)/2 + y0*dx
        // So:  m = 2*(targetArea - y0*dx) / (dx*dx)
        if (PG.state.continuous) {
          const m = 2 * (targetArea - y0 * dx) / (dx * dx);
          seg.params = { m, b: y0 - m * x0 };
        } else {
          // Without continuity, just use triangle: area = dx * avg_y => avg_y = area/dx
          // linear from 0 to 2*avgY over dx
          const avgY = targetArea / dx;
          const m = 2 * avgY / dx;
          seg.params = { m, b: 0 };
        }
        break;
      }

      case 'quadratic': {
        // integral = a*(x-h)^3/3 + v*x  from x0 to x1
        // With vertex at (x0, y0):
        // integral = a*(x1-x0)^3/3 + y0*(x1-x0)
        // => a = 3*(targetArea - y0*dx) / (dx^3)
        if (PG.state.continuous) {
          const a = 3 * (targetArea - y0 * dx) / (dx * dx * dx);
          seg.params = { a, h: x0, v: y0 };
        } else {
          const a = 3 * targetArea / (dx * dx * dx);
          seg.params = { a, h: x0, v: 0 };
        }
        break;
      }

      default: {
        // For other types, fall back to linear approximation
        // or use constant if we can't solve analytically
        if (PG.state.continuous) {
          const m = 2 * (targetArea - y0 * dx) / (dx * dx);
          seg.type = 'linear';
          seg.params = { m, b: y0 - m * x0 };
        } else {
          // Use constant
          seg.type = 'constant';
          seg.params = { c: targetArea / dx };
        }
        break;
      }
    }
  }

  /**
   * Read UI inputs and apply to selected segment.
   */
  function applyFromUI() {
    const segIdx = PG.state.selectedSegment;
    if (segIdx === null || segIdx < 0) {
      alert('Please select a segment first.');
      return;
    }

    const mode = document.querySelector('input[name="advMode"]:checked').value;
    const value = parseFloat(document.getElementById('advValue').value);

    if (isNaN(value)) {
      alert('Please enter a valid number.');
      return;
    }

    if (mode === 'slope') {
      applySlope(segIdx, value);
    } else {
      applyIntegral(segIdx, value);
    }

    PG.UI.refreshSegmentList();
    PG.Graph.render();
  }

  /* ---------- init ---------- */

  function init() {
    document.getElementById('btnAdvApply').addEventListener('click', applyFromUI);
  }

  return { init, applySlope, applyIntegral };
})();
