// SVG builders: status marks, system profile, share bar, range bar, history chart.
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

// ---- shared track ---------------------------------------------------------------
// Every scale in the app uses the same geometry: the middle half of the track is
// the reference range, the outer quarters are below and above it.

const X_LOW = W * 0.25, X_HIGH = W * 0.75;

function track(y, height) {
  const r = height / 2;
  return [
    svg("rect", { class: "zone zone-edge", x: 0, y, width: W, height, rx: r }),
    svg("rect", { class: "zone zone-ref", x: X_LOW, y, width: X_HIGH - X_LOW, height }),
    svg("line", { class: "tick", x1: X_LOW, x2: X_LOW, y1: y - 2, y2: y + height + 2 }),
    svg("line", { class: "tick", x1: X_HIGH, x2: X_HIGH, y1: y - 2, y2: y + height + 2 }),
  ];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const labelOf = (ms) => ms.def.short_name || ms.def.name;
// Width of a label in viewBox units; an estimate is enough to keep labels apart.
const textWidth = (text, size = 11.5) => text.length * size * 0.56;

// ---- system profile -------------------------------------------------------------
// All primary markers of one system on one normalised scale. Marks that would
// overlap are stacked (a small beeswarm), and every mark outside its target is
// labelled with its name and value, so the outliers are never anonymous.

export function domainProfile(markerStates) {
  const marks = markerStates.filter((m) => m && m.latest && m.position != null);
  if (!marks.length) return null;

  const flagged = marks.filter((m) => m.status === "out" || m.status === "watch")
    .sort((a, b) => (SEVERITY[b.status] ?? 0) - (SEVERITY[a.status] ?? 0));
  const rest = marks.filter((m) => !flagged.includes(m)).sort((a, b) => a.position - b.position);

  // Stack: flagged marks take the axis first, the rest fill in around them.
  const R = 4.5, GAP = 10.5, ROWS = [0, -1, 1, -2, 2];
  const taken = ROWS.map(() => []);
  const placed = [];
  for (const m of [...flagged, ...rest]) {
    const x = clamp(m.position * W, R + 2, W - R - 2);
    let row = ROWS.findIndex((_, i) => taken[i].every((other) => Math.abs(other - x) >= GAP));
    if (row < 0) row = 0;
    taken[row].push(x);
    placed.push({ m, x, row: ROWS[row] });
  }
  const depth = Math.max(0, ...placed.map((p) => Math.abs(p.row)));

  // Labels for flagged marks, at most three, on up to two lines above the track.
  const labels = [];
  for (const p of placed.filter((q) => flagged.includes(q.m)).slice(0, 3)) {
    const text = `${labelOf(p.m)} ${formatValue(p.m.latest.value, p.m.def.decimals ?? 0, p.m.latest.comparator)}`;
    const width = textWidth(text);
    const cx = clamp(p.x, width / 2 + 1, W - width / 2 - 1);
    let line = 0;
    while (labels.some((l) => l.line === line && Math.abs(l.cx - cx) < (l.width + width) / 2 + 6)) line += 1;
    labels.push({ ...p, text, width, cx, line });
  }
  const labelLines = labels.length ? Math.max(...labels.map((l) => l.line)) + 1 : 0;

  const STEP = 9, trackH = 18 + depth * STEP * 2;
  const top = labelLines * 14 + (labelLines ? 6 : 2);
  const cy = top + trackH / 2;
  const H = top + trackH + 18;

  const n = (status) => marks.filter((m) => m.status === status).length;
  const root = svg("svg", {
    class: "profile", viewBox: `0 0 ${W} ${H}`, role: "img", focusable: "false",
    "aria-label": `Показателей на шкале: ${marks.length}. В норме: ${n("optimal")}, внимание: ${n("watch")}, вне нормы: ${n("out")}.`,
  });
  root.append(...track(top, trackH));

  for (const l of labels) {
    const ly = top - 6 - (labelLines - 1 - l.line) * 14;
    const markY = cy + l.row * STEP;
    root.append(
      svg("line", { class: "leader", x1: l.x, x2: l.x, y1: ly + 3, y2: markY - R - 2 }),
      svg("text", { class: "profile-label", x: l.cx, y: ly, "text-anchor": "middle" }, l.text));
  }
  // Quiet marks first, flagged on top.
  for (const p of placed.slice().reverse()) root.append(mark(p.m.status, p.x, cy + p.row * STEP, R));

  const caption = (x, text) => svg("text", { class: "profile-caption", x, y: H - 4, "text-anchor": "middle" }, text);
  root.append(caption(X_LOW / 2, "ниже"), caption(W / 2, "в норме"), caption((X_HIGH + W) / 2, "выше"));
  return root;
}

// ---- share bar ------------------------------------------------------------------
// Part-to-whole of marker statuses: how much is measured and how much of it is fine.

const SHARE_ORDER = ["out", "watch", "optimal", "unrated", "nodata"];

export function shareBar(counts) {
  const total = SHARE_ORDER.reduce((sum, s) => sum + (counts[s] || 0), 0);
  if (!total) return null;
  const H = 12, GAP = 2;
  const parts = SHARE_ORDER.filter((s) => counts[s] > 0);
  const usable = W - GAP * (parts.length - 1);
  const root = svg("svg", { class: "share", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
  let x = 0;
  parts.forEach((s, i) => {
    const width = Math.max(4, (counts[s] / total) * usable);
    const end = i === parts.length - 1 ? W : x + width;
    root.append(svg("rect", { class: "share-part share-" + s, x, y: 0, width: Math.max(1, end - x), height: H, rx: 3 }));
    x = end + GAP;
  });
  return root;
}

// ---- priority -------------------------------------------------------------------

export function priorityIcon(priority) {
  const filled = priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  const root = svg("svg", { class: "priority-icon", viewBox: "0 0 16 14", width: 16, height: 14, "aria-hidden": "true", focusable: "false" });
  [5, 9, 13].forEach((h0, i) => {
    root.append(svg("rect", { class: i < filled ? "bar on" : "bar", x: i * 6, y: 14 - h0, width: 4, height: h0, rx: 1 }));
  });
  return root;
}

// ---- range bar ------------------------------------------------------------------
// One marker on the shared scale. `compact` is the unlabelled version used in
// lists, so a column of markers reads as a panel of aligned gauges.

function optimalBand(ms, y, height) {
  const ref = ms.ref, opt = ms.def.optimal;
  if (!opt || (opt.low == null && opt.high == null)) return null;
  const a = opt.low != null ? positionFor(opt.low, ref) : 0.25;
  const b = opt.high != null ? positionFor(opt.high, ref) : 0.75;
  const p1 = clamp(a ?? 0.25, 0.25, 0.75), p2 = clamp(b ?? 0.75, 0.25, 0.75);
  const x1 = Math.min(p1, p2) * W, x2 = Math.max(p1, p2) * W;
  if (x2 - x1 < 2) return null;
  return svg("rect", { class: "zone zone-optimal", x: x1, y, width: x2 - x1, height });
}

export function rangeBar(ms, { compact = false } = {}) {
  const ref = ms.ref;
  if (!ref || (ref.low == null && ref.high == null)) {
    return compact ? null : h("span", { class: "muted no-ref" }, "Нет референса");
  }
  const th = compact ? 8 : 14, pad = compact ? 4 : 4;
  const H = th + pad * 2, y = pad, cy = y + th / 2;
  const root = svg("svg", {
    class: compact ? "strip compact" : "strip", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false",
  });
  root.append(...track(y, th));
  const band = optimalBand(ms, y, th);
  if (band) root.insertBefore(band, root.children[2]); // above the zones, under the ticks
  if (ms.latest && ms.position != null) root.append(mark(ms.status, ms.position * W, cy, compact ? 4 : 5.5));
  if (compact) return root;

  const dec = ms.def.decimals ?? 0;
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
