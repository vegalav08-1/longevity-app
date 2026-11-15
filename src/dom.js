// Tiny hyperscript helpers and shared formatting helpers. No innerHTML anywhere.
import { formatValue } from "./engine.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function applyProps(el, props) {
  if (!props) return;
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === "style") throw new Error("inline style is not allowed; use classes or the CSSOM");
    if (key.length > 2 && key.startsWith("on") && typeof val === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === "class") {
      el.setAttribute("class", Array.isArray(val) ? val.filter(Boolean).join(" ") : String(val));
    } else if (key === "value" && "value" in el) {
      el.value = val;
    } else {
      el.setAttribute(key, val === true ? "" : String(val));
    }
  }
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, attrs);
  append(el, children);
  return el;
}

// ---- formatting helpers shared by charts and views ----

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

export function formatDateRu(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  return dateFmt.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

const NBSP = " ";

export function unitSuffix(def) {
  return def && def.unit_label ? NBSP + def.unit_label : "";
}

// "5,2 ммоль/л" for a Point and its MarkerDef.
export function valueText(point, def) {
  return formatValue(point.value, def.decimals ?? 0, point.comparator) + unitSuffix(def);
}

// Reference as "от–до", "до X", "от X" or "—".
export function refText(ref, decimals) {
  const lo = ref && ref.low != null ? formatValue(ref.low, decimals) : null;
  const hi = ref && ref.high != null ? formatValue(ref.high, decimals) : null;
  if (lo != null && hi != null) return lo + "–" + hi;
  if (hi != null) return "до" + NBSP + hi;
  if (lo != null) return "от" + NBSP + lo;
  return "—";
}
