/**
 * main.js
 * Application entry point: state management, UI bindings, segment list rendering.
 *
 * Depends on: PG, PG.Relationships, PG.Graph, PG.Editor, PG.Advanced
 */

/* global PG */

/* ========== Application State ========== */

PG.state = {
  xLabel: 'Time (s)',
  yLabel: 'Velocity (m/s)',
  mode: 'qualitative',     // 'qualitative' | 'quantitative'
  maxX: 10,
  maxY: 10,
  minY: -10,
  showGrid: true,
  continuous: true,         // enforce segment continuity
  selectedSegment: null,    // index or null
  segments: [],
  dataPoints: [],           // [{ x, y }] standalone plotted points
  plotPointsMode: false,    // when true, clicks place data points
};

/* ========== UI helpers (PG.UI) ========== */

PG.UI = (function () {
  'use strict';

  /* ---------- segment list rendering ---------- */

  function refreshSegmentList() {
    const container = document.getElementById('segmentList');
    container.innerHTML = '';

    PG.state.segments.forEach((seg, idx) => {
      const card = document.createElement('div');
      card.className = 'segment-card' + (PG.state.selectedSegment === idx ? ' selected' : '');
      card.dataset.index = idx;

      const color = PG.Graph.COLORS[idx % PG.Graph.COLORS.length];

      card.innerHTML = `
        <div class="seg-header">
          <span><span class="seg-color-dot" style="background:${color}"></span>Segment ${idx + 1}</span>
          <button class="seg-remove" data-idx="${idx}" title="Remove segment">&times;</button>
        </div>
        <div class="seg-row">
          <label>x Start
            <input type="number" class="seg-xstart" data-idx="${idx}" value="${seg.xStart}" step="any" min="0" />
          </label>
          <label>x End
            <input type="number" class="seg-xend" data-idx="${idx}" value="${seg.xEnd}" step="any" min="0" />
          </label>
        </div>
        <label>Relationship
          <select class="seg-type" data-idx="${idx}">
            ${PG.Relationships.list().map(r =>
              `<option value="${r.id}" ${r.id === seg.type ? 'selected' : ''}>${r.label}</option>`
            ).join('')}
          </select>
        </label>
        <div class="seg-params" data-idx="${idx}"></div>
      `;

      container.appendChild(card);

      // Render parameter inputs
      renderParamInputs(card.querySelector('.seg-params'), seg, idx);
    });

    // Bind events
    bindSegmentEvents();
  }

  function renderParamInputs(container, seg, idx) {
    const rel = PG.Relationships.get(seg.type);
    if (!rel || !rel.params) return;

    rel.params.forEach(p => {
      const val = seg.params[p.key] !== undefined ? seg.params[p.key] : (rel.defaults[p.key] || 0);
      const label = document.createElement('label');
      label.innerHTML = `${p.label}
        <input type="number" class="seg-param" data-idx="${idx}" data-key="${p.key}" value="${parseFloat(val.toPrecision(6))}" step="${p.step || 0.1}" />
      `;
      container.appendChild(label);
    });
  }

  function bindSegmentEvents() {
    // Card click → select
    document.querySelectorAll('.segment-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't select if clicking on an input, select, or button
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
        const idx = parseInt(card.dataset.index);
        PG.state.selectedSegment = idx;
        refreshSegmentList();
        PG.Graph.render();
      });
    });

    // Remove buttons
    document.querySelectorAll('.seg-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        PG.state.segments.splice(idx, 1);
        if (PG.state.selectedSegment === idx) PG.state.selectedSegment = null;
        else if (PG.state.selectedSegment > idx) PG.state.selectedSegment--;
        refreshSegmentList();
        PG.Graph.render();
      });
    });

    // x-range inputs
    document.querySelectorAll('.seg-xstart').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        PG.state.segments[idx].xStart = parseFloat(input.value) || 0;
        enforceContinuity();
        PG.Graph.render();
      });
    });
    document.querySelectorAll('.seg-xend').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        PG.state.segments[idx].xEnd = parseFloat(input.value) || PG.state.maxX;
        enforceContinuity();
        PG.Graph.render();
      });
    });

    // Relationship type selects
    document.querySelectorAll('.seg-type').forEach(select => {
      select.addEventListener('change', () => {
        const idx = parseInt(select.dataset.idx);
        const newType = select.value;
        const rel = PG.Relationships.get(newType);
        PG.state.segments[idx].type = newType;
        PG.state.segments[idx].params = { ...rel.defaults };
        enforceContinuity();
        refreshSegmentList();
        PG.Graph.render();
      });
    });

    // Parameter inputs
    document.querySelectorAll('.seg-param').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx);
        const key = input.dataset.key;
        const val = parseFloat(input.value);
        if (!isNaN(val)) {
          PG.state.segments[idx].params[key] = val;
          PG.Graph.render();
        }
      });
    });
  }

  /* ---------- continuity enforcement ---------- */

  function enforceContinuity() {
    if (!PG.state.continuous) return;
    const segs = PG.state.segments;
    if (segs.length < 2) return;

    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1];
      const curr = segs[i];
      const prevRel = PG.Relationships.get(prev.type);
      const currRel = PG.Relationships.get(curr.type);
      if (!prevRel || !currRel) continue;

      // Make current segment start where previous ends
      curr.xStart = prev.xEnd;

      // Get y-value at the boundary
      const yBoundary = prevRel.fn(prev.xEnd, prev.params);
      if (!isFinite(yBoundary)) continue;

      // Get y-value at the end of current segment
      const yEnd = currRel.fn(curr.xEnd, curr.params);
      const yEndTarget = isFinite(yEnd) ? yEnd : yBoundary;

      // Refit current segment to pass through boundary
      const fitted = currRel.fitTo(curr.xStart, yBoundary, curr.xEnd, yEndTarget);
      Object.assign(curr.params, fitted);
    }
  }

  /* ---------- data points list ---------- */

  function refreshDataPoints() {
    const container = document.getElementById('dataPointsList');
    if (!container) return;
    container.innerHTML = '';

    PG.state.dataPoints.forEach((pt, idx) => {
      const row = document.createElement('div');
      row.className = 'dp-row';
      const label = PG.state.mode === 'quantitative'
        ? `(${parseFloat(pt.x.toPrecision(4))}, ${parseFloat(pt.y.toPrecision(4))})`
        : `Point ${idx + 1}`;
      row.innerHTML = `
        <span class="dp-label">${label}</span>
        <button class="seg-remove dp-remove" data-idx="${idx}" title="Remove point">&times;</button>
      `;
      container.appendChild(row);
    });

    // Bind remove buttons
    container.querySelectorAll('.dp-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        PG.state.dataPoints.splice(idx, 1);
        refreshDataPoints();
        PG.Graph.render();
      });
    });
  }

  /* ---------- init ---------- */

  function init() {
    const $ = id => document.getElementById(id);

    // Axis label inputs
    $('xLabel').addEventListener('input', () => {
      PG.state.xLabel = $('xLabel').value || 'x';
      PG.Graph.render();
    });
    $('yLabel').addEventListener('input', () => {
      PG.state.yLabel = $('yLabel').value || 'y';
      PG.Graph.render();
    });

    // Mode toggle
    $('btnQualitative').addEventListener('click', () => {
      PG.state.mode = 'qualitative';
      $('btnQualitative').classList.add('active');
      $('btnQuantitative').classList.remove('active');
      $('quantControls').classList.add('hidden');
      PG.Graph.render();
    });
    $('btnQuantitative').addEventListener('click', () => {
      PG.state.mode = 'quantitative';
      $('btnQuantitative').classList.add('active');
      $('btnQualitative').classList.remove('active');
      $('quantControls').classList.remove('hidden');
      PG.Graph.render();
    });

    // Quantitative range inputs
    $('maxX').addEventListener('input', () => {
      const v = parseFloat($('maxX').value);
      if (v > 0) { PG.state.maxX = v; PG.Graph.render(); }
    });
    $('maxY').addEventListener('input', () => {
      const v = parseFloat($('maxY').value);
      if (v > 0) { PG.state.maxY = v; PG.Graph.render(); }
    });
    $('minY').addEventListener('input', () => {
      const v = parseFloat($('minY').value);
      if (v < PG.state.maxY) { PG.state.minY = v; PG.Graph.render(); }
    });

    // Grid checkbox
    $('chkGrid').addEventListener('change', () => {
      PG.state.showGrid = $('chkGrid').checked;
      PG.Graph.render();
    });

    // Continuous checkbox
    $('chkSnapContinuous').addEventListener('change', () => {
      PG.state.continuous = $('chkSnapContinuous').checked;
      if (PG.state.continuous) enforceContinuity();
      PG.Graph.render();
    });

    // Data points mode toggle
    $('btnPlotPointsOff').addEventListener('click', () => {
      PG.state.plotPointsMode = false;
      $('btnPlotPointsOff').classList.add('active');
      $('btnPlotPointsOn').classList.remove('active');
      document.getElementById('graphCanvas').style.cursor = 'crosshair';
    });
    $('btnPlotPointsOn').addEventListener('click', () => {
      PG.state.plotPointsMode = true;
      $('btnPlotPointsOn').classList.add('active');
      $('btnPlotPointsOff').classList.remove('active');
      document.getElementById('graphCanvas').style.cursor = 'copy';
    });
    $('btnClearPoints').addEventListener('click', () => {
      PG.state.dataPoints = [];
      refreshDataPoints();
      PG.Graph.render();
    });

    // Add segment button
    $('btnAddSegment').addEventListener('click', addSegment);

    // Advanced toggle
    $('btnToggleAdvanced').addEventListener('click', () => {
      const panel = $('advancedPanel');
      const btn = $('btnToggleAdvanced');
      if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        btn.textContent = 'Hide';
      } else {
        panel.classList.add('hidden');
        btn.textContent = 'Show';
      }
    });

    // Export
    $('btnExport').addEventListener('click', () => PG.Graph.exportPNG());

    // Window resize
    window.addEventListener('resize', () => PG.Graph.render());

    // Create initial segment
    addSegment();
  }

  function addSegment() {
    const segs = PG.state.segments;
    const lastEnd = segs.length > 0 ? segs[segs.length - 1].xEnd : 0;
    // First segment spans full range; subsequent ones split remaining space
    const remaining = PG.state.maxX - lastEnd;
    const newEnd = segs.length === 0
      ? PG.state.maxX
      : Math.min(lastEnd + remaining * 0.5, PG.state.maxX);

    if (lastEnd >= PG.state.maxX) {
      alert('No room for another segment. Increase Max X or adjust existing segments.');
      return;
    }

    const defaultType = 'proportional';
    const rel = PG.Relationships.get(defaultType);

    const seg = {
      xStart: lastEnd,
      xEnd: newEnd,
      type: defaultType,
      params: { ...rel.defaults },
    };

    segs.push(seg);
    PG.state.selectedSegment = segs.length - 1;

    if (PG.state.continuous) enforceContinuity();
    refreshSegmentList();
    PG.Graph.render();
  }

  return { init, refreshSegmentList, enforceContinuity, refreshDataPoints };
})();

/* ========== Boot ========== */

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('graphCanvas');
  PG.Graph.init(canvas);
  PG.Editor.init(canvas);
  PG.Advanced.init();
  PG.DrawFit.init(canvas);
  PG.UI.init();
});
