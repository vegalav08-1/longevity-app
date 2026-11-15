// SVG builders: status marks, range bar, history chart.
import { formatValue, positionFor } from "./engine.js";
import { h, svg, formatDateRu, valueText } from "./dom.js";

const W = 330; // shared viewBox width, close to the real content width on a phone
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

// ---- marks -------------------------------------------------------------

// Returns a <g> with a white ring under a status-shaped mark.
// optimal: filled circle, watch: diamond, out: triangle, unrated: small circle,
// nodata: hollow circle.
function mark(status, cx, cy, size = 5) {
  const g = svg("g", { class: "mark-group" });
  const ring = (el) => { el.setAttribute("class", "mark-ring"); return el; };
  if (status === "watch") {
    const r = size + 1;
    const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
    g.append(ring(svg("polygon", { points: pts })), svg("polygon", { points: pts, class: "mark mark-watch" }));
  } else if (status === "out") {
    const r = size + 1;
    const pts = `${cx},${cy - r} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}`;
    g.append(ring(svg("polygon", { points: pts })), svg("polygon", { points: pts, class: "mark mark-out" }));
  } else if (status === "unrated") {
    const r = size * 0.7;
    g.append(ring(svg("circle", { cx, cy, r })), svg("circle", { cx, cy, r, class: "mark mark-unrated" }));
  } else if (status === "nodata") {
    g.append(svg("circle", { cx, cy, r: size - 0.75, class: "mark mark-nodata" }));
  } else {
    g.append(ring(svg("circle", { cx, cy, r: size })), svg("circle", { cx, cy, r: size, class: "mark mark-optimal" }));
  }
  return g;
}

// Small inline icon for status words in HTML rows.
export function statusIcon(status) {
  const s = svg("svg", { class: "status-icon", viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true", focusable: "false" });
  const g = mark(status, 7, 7.5, 4.5);
  for (const r of g.querySelectorAll(".mark-ring")) r.remove();
  s.append(g);
  return s;
}

const SEVERITY = { unrated: 0, optimal: 1, watch: 2, out: 3 };

// ---- track -------------------------------------------------------------

function trackParts(y, th) {
  const x1 = W * 0.25, x2 = W * 0.75;
  return [
    svg("rect", { class: "zone zone-low", x: 0, y, width: x1, height: th }),
    svg("rect", { class: "zone zone-ref", x: x1, y, width: x2 - x1, height: th }),
    svg("rect", { class: "zone zone-high", x: x2, y, width: W - x2, height: th }),
    svg("line", { class: "tick", x1, x2: x1, y1: y - 2, y2: y + th + 2 }),
    svg("line", { class: "tick", x1: x2, x2, y1: y - 2, y2: y + th + 2 }),
  ];
}

// ---- range bar -------------------------------------------------------------

export function rangeBar(ms) {
  const ref = ms.ref;
  if (!ref || (ref.low == null && ref.high == null)) {
    return h("span", { class: "muted no-ref" }, "Нет референса");
  }
  const H = 28, y = 3, th = 14, cy = y + th / 2;
  const dec = ms.def.decimals ?? 0;
  const root = svg("svg", { class: "strip", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
  root.append(...trackParts(y, th));

  const opt = ms.def.optimal;
  if (opt && (opt.low != null || opt.high != null)) {
    const clamp = (v) => Math.min(0.96, Math.max(0.04, v));
    const a = opt.low != null ? positionFor(opt.low, ref) : 0.25;
    const b = opt.high != null ? positionFor(opt.high, ref) : 0.75;
    const p1 = clamp(a ?? 0.25), p2 = clamp(b ?? 0.75);
    const x1 = Math.min(p1, p2) * W, x2 = Math.max(p1, p2) * W;
    root.append(svg("rect", { class: "optimal-line", x: x1, y: y + th + 4, width: Math.max(2, x2 - x1), height: 3 }));
  }
  if (ms.latest && ms.position != null) root.append(mark(ms.status, ms.position * W, cy, 5));

  const labels = h("div", { class: "rb-labels", "aria-hidden": "true" });
  // With only an upper bound the left tick stands for zero (see positionFor).
  const lowLabel = ref.low != null ? formatValue(ref.low, dec) : ref.high != null ? "0" : null;
  if (lowLabel != null) {
    const l = h("span", { class: "rb-label" }, lowLabel);
    l.style.left = "25%";
    labels.append(l);
  }
  if (ref.high != null) {
    const l = h("span", { class: "rb-label" }, formatValue(ref.high, dec));
    l.style.left = "75%";
    labels.append(l);
  }
  return h("div", { class: "rangebar" }, root, labels);
}

// ---- history chart ---------------------------------------------------------

export function historyChart(ms) {
  const pts = ms.series || [];
  const def = ms.def;
  const dec = def.decimals ?? 0;
  const H = 200, plotL = 44, plotR = W - 12, plotT = 10, plotB = H - 26;
  const hasBound = (r) => r && (r.low != null || r.high != null);
  const ref = [ms.latest && ms.latest.ref, ms.ref].find(hasBound) || null;
  const hasLow = ref && ref.low != null, hasHigh = ref && ref.high != null;

  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const dataLo = lo, dataHi = hi;
  for (const b of [hasLow ? ref.low : null, hasHigh ? ref.high : null]) {
    if (b != null) { lo = Math.min(lo, b); hi = Math.max(hi, b); }
  }
  if (!(hi > lo)) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo -= pad; hi += pad;
  } else {
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
  }
  const yFor = (v) => plotB - ((v - lo) / (hi - lo)) * (plotB - plotT);

  const times = pts.map((p) => Date.parse(p.date + "T00:00:00Z"));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const xa = plotL + 14, xb = plotR - 14;
  const xFor = (t) => (t1 > t0 ? xa + ((t - t0) / (t1 - t0)) * (xb - xa) : (plotL + plotR) / 2);

  const root = svg("svg", {
    class: "history", viewBox: `0 0 ${W} ${H}`, role: "group", focusable: "false",
    "aria-label": `График: ${def.name}, измерений ${pts.length}`,
  });

  // reference band
  if (hasLow || hasHigh) {
    const top = hasHigh ? Math.max(plotT, yFor(ref.high)) : plotT;
    const bottom = hasLow ? Math.min(plotB, yFor(ref.low)) : plotB;
    if (bottom > top) root.append(svg("rect", { class: "band", x: plotL, y: top, width: plotR - plotL, height: bottom - top }));
  }
  root.append(svg("line", { class: "axis", x1: plotL, x2: plotR, y1: plotB, y2: plotB }));

  // y labels
  const yl = [];
  const addLabel = (v, bound) => {
    const y = yFor(v);
    if (y < plotT - 4 || y > plotB + 4) return;
    if (yl.some((o) => Math.abs(o.y - y) < 15)) return;
    yl.push({ y, v, bound });
  };
  if (hasHigh) addLabel(ref.high, true);
  if (hasLow) addLabel(ref.low, true);
  if (!hasLow || dataLo < ref.low) addLabel(dataLo, false);
  if (!hasHigh || dataHi > ref.high) addLabel(dataHi, false);
  for (const o of yl) {
    if (o.bound) root.append(svg("line", { class: "bound-line", x1: plotL, x2: plotR, y1: o.y, y2: o.y }));
    root.append(svg("text", { class: "axis-label", x: plotL - 6, y: o.y + 4, "text-anchor": "end" }, formatValue(o.v, dec)));
  }

  // x labels: month and year, at most four, no duplicates
  const nTicks = Math.min(4, pts.length);
  let lastLabel = null;
  for (let i = 0; i < nTicks; i++) {
    const t = nTicks === 1 ? t0 : t0 + ((t1 - t0) * i) / (nTicks - 1);
    const d = new Date(t);
    const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (label === lastLabel) continue;
    lastLabel = label;
    const x = Math.min(W - 28, Math.max(plotL, xFor(t)));
    root.append(svg("text", { class: "axis-label", x, y: H - 6, "text-anchor": "middle" }, label));
  }

  // line
  const coords = pts.map((p, i) => [xFor(times[i]), yFor(p.value)]);
  if (pts.length > 1) {
    root.append(svg("polyline", { class: "series-line", points: coords.map((c) => c.join(",")).join(" ") }));
  }
  // marks, worst on top
  const order = pts.map((p, i) => i).sort((a, b) => (SEVERITY[pts[a].status] ?? 0) - (SEVERITY[pts[b].status] ?? 0));
  for (const i of order) root.append(mark(pts[i].status, coords[i][0], coords[i][1], 5));

  // tooltip + hit targets
  const tip = h("div", { class: "tooltip", hidden: true, role: "status" });
  const chart = h("div", { class: "chart" }, root, tip);
  const hide = () => { tip.hidden = true; };
  const show = (i) => {
    const p = pts[i], [x, y] = coords[i];
    tip.replaceChildren(h("span", { class: "tip-date" }, formatDateRu(p.date)), h("span", { class: "tip-value" }, valueText(p, def)));
    tip.hidden = false;
    tip.style.left = ((x / W) * 100) + "%";
    tip.style.top = ((y / H) * 100) + "%";
    const shiftX = x / W < 0.22 ? "-15%" : x / W > 0.78 ? "-85%" : "-50%";
    const shiftY = y < 60 ? "14px" : "calc(-100% - 14px)";
    tip.style.transform = `translate(${shiftX}, ${shiftY})`;
  };
  pts.forEach((p, i) => {
    const hit = svg("circle", {
      class: "hit", cx: coords[i][0], cy: coords[i][1], r: 26, tabindex: 0, role: "button",
      "aria-label": `${formatDateRu(p.date)}: ${valueText(p, def)}`,
    });
    hit.addEventListener("click", (e) => { e.stopPropagation(); show(i); });
    hit.addEventListener("focus", () => show(i));
    hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(i); } });
    root.append(hit);
  });
  const outside = (e) => {
    if (!chart.isConnected) { document.removeEventListener("click", outside); return; }
    hide();
  };
  document.addEventListener("click", outside);
  chart.addEventListener("click", (e) => { if (e.target === chart || e.target === root) hide(); });

  const wrap = h("div", { class: "chart-wrap" }, chart);
  if (pts.length === 1) wrap.append(h("p", { class: "muted chart-caption" }, "Одно измерение. Динамика появится после следующего."));
  return wrap;
}
