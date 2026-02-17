/**
 * relationships.js
 * Defines every relationship type available in the graph generator.
 *
 * Each relationship exposes:
 *   id        – unique key
 *   label     – human-friendly name
 *   fn(x, p)  – evaluator; p = parameter object
 *   defaults  – default parameter values
 *   params    – ordered list of { key, label, step } for UI
 *   fitTo(x0, y0, x1, y1) – returns params that pass through (x0,y0) and (x1,y1)
 *                            Used for continuity enforcement and advanced mode.
 *   integral(x0, x1, p)   – definite integral from x0 to x1
 *   slopeAt(x, p)         – dy/dx at x
 */

/* global PG */
/* exported PG */

// eslint-disable-next-line no-var
var PG = window.PG || {};

PG.Relationships = (function () {
  'use strict';

  /* ---------- helpers ---------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const EPSILON = 1e-12;
  const safe = v => (Math.abs(v) < EPSILON ? EPSILON : v);

  /* ---------- catalogue ---------- */

  const types = {};

  /* 1. Constant */
  types.constant = {
    id: 'constant',
    label: 'Constant',
    params: [{ key: 'c', label: 'Value (c)', step: 0.5 }],
    defaults: { c: 0 },
    fn: (_x, p) => p.c,
    integral: (x0, x1, p) => p.c * (x1 - x0),
    slopeAt: (_x, _p) => 0,
    fitTo: (_x0, y0, _x1, _y1) => ({ c: y0 }),
  };

  /* 2. Directly Proportional  y = kx */
  types.proportional = {
    id: 'proportional',
    label: 'Directly Proportional (y = kx)',
    params: [{ key: 'k', label: 'Constant k', step: 0.5 }],
    defaults: { k: 1 },
    fn: (x, p) => p.k * x,
    integral: (x0, x1, p) => p.k * (x1 * x1 - x0 * x0) / 2,
    slopeAt: (_x, p) => p.k,
    fitTo: (_x0, _y0, x1, y1) => ({ k: y1 / safe(x1) }),
  };

  /* 3. Linear  y = mx + b */
  types.linear = {
    id: 'linear',
    label: 'Linear (y = mx + b)',
    params: [
      { key: 'm', label: 'Slope (m)', step: 0.5 },
      { key: 'b', label: 'Intercept (b)', step: 0.5 },
    ],
    defaults: { m: 1, b: 0 },
    fn: (x, p) => p.m * x + p.b,
    integral: (x0, x1, p) => p.m * (x1 * x1 - x0 * x0) / 2 + p.b * (x1 - x0),
    slopeAt: (_x, p) => p.m,
    fitTo: (x0, y0, x1, y1) => {
      const m = (y1 - y0) / safe(x1 - x0);
      return { m, b: y0 - m * x0 };
    },
  };

  /* 4. Quadratic  y = a(x - h)^2 + v  (vertex form) */
  types.quadratic = {
    id: 'quadratic',
    label: 'Quadratic (y = ax\u00B2)',
    params: [
      { key: 'a', label: 'Coefficient (a)', step: 0.1 },
      { key: 'h', label: 'Vertex x (h)', step: 0.5 },
      { key: 'v', label: 'Vertex y (v)', step: 0.5 },
    ],
    defaults: { a: 1, h: 0, v: 0 },
    fn: (x, p) => p.a * (x - p.h) ** 2 + p.v,
    integral: (x0, x1, p) => {
      const A = p.a, H = p.h, V = p.v;
      const F = x => A * ((x - H) ** 3) / 3 + V * x;
      return F(x1) - F(x0);
    },
    slopeAt: (x, p) => 2 * p.a * (x - p.h),
    fitTo: (x0, y0, x1, y1) => {
      // Simple: vertex at x0, solve a from (x1,y1)
      const h = x0;
      const v = y0;
      const dx = x1 - x0;
      const a = (y1 - y0) / safe(dx * dx);
      return { a, h, v };
    },
  };

  /* 5. Square root  y = a * sqrt(x - h) + v */
  types.sqrt = {
    id: 'sqrt',
    label: 'Square Root (y = a\u221Ax)',
    params: [
      { key: 'a', label: 'Coefficient (a)', step: 0.5 },
      { key: 'h', label: 'Shift x (h)', step: 0.5 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { a: 1, h: 0, v: 0 },
    fn: (x, p) => {
      const arg = x - p.h;
      return arg >= 0 ? p.a * Math.sqrt(arg) + p.v : p.v;
    },
    integral: (x0, x1, p) => {
      const A = p.a, H = p.h, V = p.v;
      const F = x => {
        const arg = x - H;
        return arg >= 0 ? A * (2 / 3) * arg ** 1.5 + V * x : V * x;
      };
      return F(x1) - F(x0);
    },
    slopeAt: (x, p) => {
      const arg = x - p.h;
      return arg > 0 ? p.a / (2 * Math.sqrt(arg)) : 0;
    },
    fitTo: (x0, y0, x1, y1) => {
      const h = x0;
      const v = y0;
      const arg = x1 - x0;
      const a = arg > 0 ? (y1 - y0) / Math.sqrt(arg) : 1;
      return { a, h, v };
    },
  };

  /* 6. Inverse  y = k / (x - h) + v */
  types.inverse = {
    id: 'inverse',
    label: 'Inverse (y = k/x)',
    params: [
      { key: 'k', label: 'Constant k', step: 0.5 },
      { key: 'h', label: 'Shift x (h)', step: 0.5 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { k: 1, h: 0, v: 0 },
    fn: (x, p) => {
      const d = x - p.h;
      return Math.abs(d) > EPSILON ? p.k / d + p.v : NaN;
    },
    integral: (x0, x1, p) => {
      const K = p.k, H = p.h, V = p.v;
      // integral = k * ln|x-h| + v*x  evaluated x0..x1
      const d0 = Math.abs(x0 - H), d1 = Math.abs(x1 - H);
      if (d0 < EPSILON || d1 < EPSILON) return NaN;
      return K * (Math.log(d1) - Math.log(d0)) + V * (x1 - x0);
    },
    slopeAt: (x, p) => {
      const d = x - p.h;
      return Math.abs(d) > EPSILON ? -p.k / (d * d) : NaN;
    },
    fitTo: (x0, y0, x1, y1) => {
      const h = 0;
      const v = 0;
      const k = y0 * safe(x0 - h);
      return { k, h, v };
    },
  };

  /* 7. Inverse Square  y = k / (x - h)^2 + v */
  types.inverseSq = {
    id: 'inverseSq',
    label: 'Inverse Square (y = k/x\u00B2)',
    params: [
      { key: 'k', label: 'Constant k', step: 0.5 },
      { key: 'h', label: 'Shift x (h)', step: 0.5 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { k: 1, h: 0, v: 0 },
    fn: (x, p) => {
      const d = x - p.h;
      return Math.abs(d) > EPSILON ? p.k / (d * d) + p.v : NaN;
    },
    integral: (x0, x1, p) => {
      const K = p.k, H = p.h, V = p.v;
      const d0 = x0 - H, d1 = x1 - H;
      if (Math.abs(d0) < EPSILON || Math.abs(d1) < EPSILON) return NaN;
      return -K / d1 + K / d0 + V * (x1 - x0);
    },
    slopeAt: (x, p) => {
      const d = x - p.h;
      return Math.abs(d) > EPSILON ? -2 * p.k / (d * d * d) : NaN;
    },
    fitTo: (x0, y0, x1, y1) => {
      const h = 0;
      const v = 0;
      const k = y0 * safe(x0 * x0);
      return { k, h, v };
    },
  };

  /* 8. Exponential Growth  y = a * e^(bx) + v */
  types.expGrowth = {
    id: 'expGrowth',
    label: 'Exponential Growth (y = ae\u1D47\u02E3)',
    params: [
      { key: 'a', label: 'Amplitude (a)', step: 0.5 },
      { key: 'b', label: 'Rate (b)', step: 0.1 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { a: 1, b: 0.5, v: 0 },
    fn: (x, p) => p.a * Math.exp(p.b * x) + p.v,
    integral: (x0, x1, p) => {
      const A = p.a, B = safe(p.b), V = p.v;
      return (A / B) * (Math.exp(B * x1) - Math.exp(B * x0)) + V * (x1 - x0);
    },
    slopeAt: (x, p) => p.a * p.b * Math.exp(p.b * x),
    fitTo: (x0, y0, x1, y1) => {
      const v = 0;
      const b = Math.log(Math.abs(safe(y1 - v)) / Math.abs(safe(y0 - v))) / safe(x1 - x0);
      const a = (y0 - v) / Math.exp(b * x0);
      return { a, b, v };
    },
  };

  /* 9. Exponential Decay  y = a * e^(-bx) + v */
  types.expDecay = {
    id: 'expDecay',
    label: 'Exponential Decay (y = ae\u207B\u1D47\u02E3)',
    params: [
      { key: 'a', label: 'Amplitude (a)', step: 0.5 },
      { key: 'b', label: 'Rate (b)', step: 0.1 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { a: 5, b: 0.5, v: 0 },
    fn: (x, p) => p.a * Math.exp(-p.b * x) + p.v,
    integral: (x0, x1, p) => {
      const A = p.a, B = safe(p.b), V = p.v;
      return (-A / B) * (Math.exp(-B * x1) - Math.exp(-B * x0)) + V * (x1 - x0);
    },
    slopeAt: (x, p) => -p.a * p.b * Math.exp(-p.b * x),
    fitTo: (x0, y0, x1, y1) => {
      const v = 0;
      const b = -Math.log(Math.abs(safe(y1 - v)) / Math.abs(safe(y0 - v))) / safe(x1 - x0);
      const a = (y0 - v) / Math.exp(-b * x0);
      return { a: Math.abs(a), b: Math.abs(b), v };
    },
  };

  /* 10. Logarithmic  y = a * ln(x - h) + v */
  types.logarithmic = {
    id: 'logarithmic',
    label: 'Logarithmic (y = a\u00B7ln x)',
    params: [
      { key: 'a', label: 'Coefficient (a)', step: 0.5 },
      { key: 'h', label: 'Shift x (h)', step: 0.5 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { a: 1, h: 0, v: 0 },
    fn: (x, p) => {
      const arg = x - p.h;
      return arg > 0 ? p.a * Math.log(arg) + p.v : NaN;
    },
    integral: (x0, x1, p) => {
      const A = p.a, H = p.h, V = p.v;
      const F = x => {
        const u = x - H;
        return u > 0 ? A * (u * Math.log(u) - u) + V * x : V * x;
      };
      return F(x1) - F(x0);
    },
    slopeAt: (x, p) => {
      const arg = x - p.h;
      return arg > 0 ? p.a / arg : NaN;
    },
    fitTo: (x0, y0, x1, y1) => {
      const h = 0;
      const v = y0;
      const arg = x1 - h;
      const a = arg > 0 ? (y1 - v) / safe(Math.log(arg)) : 1;
      return { a, h, v };
    },
  };

  /* 11. Sinusoidal  y = A sin(omega * x + phi) + v */
  types.sinusoidal = {
    id: 'sinusoidal',
    label: 'Sinusoidal (y = A sin(\u03C9x))',
    params: [
      { key: 'A', label: 'Amplitude (A)', step: 0.5 },
      { key: 'omega', label: 'Angular freq (\u03C9)', step: 0.1 },
      { key: 'phi', label: 'Phase (\u03C6)', step: 0.1 },
      { key: 'v', label: 'Vertical shift', step: 0.5 },
    ],
    defaults: { A: 3, omega: 1, phi: 0, v: 0 },
    fn: (x, p) => p.A * Math.sin(p.omega * x + p.phi) + p.v,
    integral: (x0, x1, p) => {
      const { A, omega, phi, v } = p;
      const w = safe(omega);
      return (-A / w) * (Math.cos(w * x1 + phi) - Math.cos(w * x0 + phi)) + v * (x1 - x0);
    },
    slopeAt: (x, p) => p.A * p.omega * Math.cos(p.omega * x + p.phi),
    fitTo: (x0, y0, x1, y1) => {
      // Keep defaults, just adjust amplitude and shift
      return { A: Math.max(Math.abs(y0), Math.abs(y1)) || 3, omega: 1, phi: 0, v: 0 };
    },
  };

  /* 12. Cubic  y = a(x-h)^3 + v */
  types.cubic = {
    id: 'cubic',
    label: 'Cubic (y = ax\u00B3)',
    params: [
      { key: 'a', label: 'Coefficient (a)', step: 0.05 },
      { key: 'h', label: 'Shift x (h)', step: 0.5 },
      { key: 'v', label: 'Shift y (v)', step: 0.5 },
    ],
    defaults: { a: 0.1, h: 0, v: 0 },
    fn: (x, p) => p.a * (x - p.h) ** 3 + p.v,
    integral: (x0, x1, p) => {
      const A = p.a, H = p.h, V = p.v;
      const F = x => A * ((x - H) ** 4) / 4 + V * x;
      return F(x1) - F(x0);
    },
    slopeAt: (x, p) => 3 * p.a * (x - p.h) ** 2,
    fitTo: (x0, y0, x1, y1) => {
      const h = x0;
      const v = y0;
      const dx = x1 - x0;
      const a = (y1 - y0) / safe(dx * dx * dx);
      return { a, h, v };
    },
  };

  /* ========== public API ========== */

  /** Ordered list of type ids for UI dropdowns */
  const order = [
    'constant', 'proportional', 'linear', 'quadratic', 'sqrt',
    'inverse', 'inverseSq', 'expGrowth', 'expDecay', 'logarithmic',
    'sinusoidal', 'cubic',
  ];

  function get(id) { return types[id]; }
  function list() { return order.map(id => types[id]); }

  return { get, list, types, order };
})();
