// Pure engine: no DOM, no network, no Date.now(). See docs/ARCHITECTURE.md.

/**
 * @typedef {{low?: number, high?: number}} Range
 * @typedef {"optimal" | "watch" | "out" | "unrated"} Status
 */

// ---------------------------------------------------------------------------
// Dates (all arithmetic on "YYYY-MM-DD" strings through UTC components)
// ---------------------------------------------------------------------------

/**
 * @param {string} date "YYYY-MM-DD"
 * @returns {{y: number, m: number, d: number}}
 */
function splitDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/**
 * @param {number} n
 * @param {number} width
 * @returns {string}
 */
function pad(n, width) {
  return String(n).padStart(width, "0");
}

/**
 * Days from date `a` to date `b` (positive when b is later).
 * @param {string} a "YYYY-MM-DD"
 * @param {string} b "YYYY-MM-DD"
 * @returns {number}
 */
function daysBetween(a, b) {
  const pa = splitDate(a);
  const pb = splitDate(b);
  const ma = Date.UTC(pa.y, pa.m - 1, pa.d);
  const mb = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((mb - ma) / 86400000);
}

/**
 * Whole years between a birth date and a date.
 * @param {string} birthDate "YYYY-MM-DD"
 * @param {string} date "YYYY-MM-DD"
 * @returns {number}
 */
export function ageAt(birthDate, date) {
  const b = splitDate(birthDate);
  const t = splitDate(date);
  let years = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) years -= 1;
  return years;
}

/**
 * Add calendar months, clamping the day to the end of the target month.
 * @param {string} date "YYYY-MM-DD"
 * @param {number} months
 * @returns {string} "YYYY-MM-DD"
 */
export function addMonths(date, months) {
  const { y, m, d } = splitDate(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12; // 0..11
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(Math.min(d, lastDay), 2)}`;
}

// ---------------------------------------------------------------------------
// Parsing and formatting
// ---------------------------------------------------------------------------

/**
 * Parse JSON Lines. Blank lines are skipped; a bad line throws an Error that
 * names its 1-based line number.
 * @param {string} text
 * @returns {object[]}
 */
export function parseJsonl(text) {
  const result = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      result.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSON on line ${i + 1}: ${error.message}`);
    }
  }
  return result;
}

/**
 * Format a value with a comma decimal separator and an optional comparator.
 * @param {number} value
 * @param {number | undefined} decimals
 * @param {"<" | ">" | undefined} [comparator]
 * @returns {string}
 */
export function formatValue(value, decimals, comparator) {
  const digits = Number.isInteger(decimals) && decimals >= 0 ? decimals : undefined;
  const text = digits === undefined ? String(value) : value.toFixed(digits);
  return `${comparator || ""}${text.replace(".", ",")}`;
}

// ---------------------------------------------------------------------------
// Status and position
// ---------------------------------------------------------------------------

/**
 * @param {unknown} x
 * @returns {boolean}
 */
function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * @param {Range | null | undefined} range
 * @returns {boolean}
 */
function hasBound(range) {
  return Boolean(range) && (isNum(range.low) || isNum(range.high));
}

/**
 * Is the value inside the range? Bounds are inclusive. A "<" comparator means
 * the true value is at most `value`, so low bounds are satisfied; ">" mirrors.
 * @param {number} value
 * @param {"<" | ">" | undefined} comparator
 * @param {Range | null | undefined} range
 * @returns {boolean}
 */
function isInside(value, comparator, range) {
  if (!range) return true;
  if (isNum(range.low) && comparator !== "<" && value < range.low) return false;
  if (isNum(range.high) && comparator !== ">" && value > range.high) return false;
  return true;
}

/**
 * @param {number} value
 * @param {"<" | ">" | null | undefined} comparator
 * @param {Range | null | undefined} ref
 * @param {Range | null | undefined} optimal
 * @returns {Status}
 */
export function evaluateStatus(value, comparator, ref, optimal) {
  if (!hasBound(ref) && !hasBound(optimal)) return "unrated";
  const cmp = comparator || undefined;
  if (!isInside(value, cmp, ref)) return "out";
  if (!isInside(value, cmp, optimal)) return "watch";
  return "optimal";
}

/**
 * Position on the calibration strip, 0.04..0.96; the reference range occupies
 * 0.25..0.75. Null when there is no reference range.
 * @param {number} value
 * @param {Range | null | undefined} ref
 * @returns {number | null}
 */
export function positionFor(value, ref) {
  if (!ref) return null;
  const hasLow = isNum(ref.low);
  const hasHigh = isNum(ref.high);
  if (!hasLow && !hasHigh) return null;

  let position;
  if (hasLow && hasHigh) {
    if (ref.high === ref.low) {
      position = value <= ref.high ? 0.5 : 0.9;
    } else {
      position = 0.25 + (0.5 * (value - ref.low)) / (ref.high - ref.low);
    }
  } else if (hasHigh) {
    position = 0.25 + (0.5 * value) / ref.high;
  } else {
    position = 0.25 + (0.5 * (value - ref.low)) / ref.low;
  }

  if (Number.isNaN(position)) position = 0.5; // 0/0 with a zero bound
  return Math.min(0.96, Math.max(0.04, position));
}

// ---------------------------------------------------------------------------
// Formulas. `inputs` is an array in the order of MarkerDef.inputs, which is
// the order of the table in the architecture document.
// ---------------------------------------------------------------------------

const KT = 1e9; // L/mol, testosterone-SHBG association constant
const KA = 3.6e4; // L/mol, testosterone-albumin association constant
const ALBUMIN_MOLAR_MASS = 69000; // g/mol

/**
 * Vermeulen free testosterone.
 * @param {number} testosterone nmol/L
 * @param {number} shbg nmol/L
 * @param {number} albumin g/L
 * @returns {{free: number, bioavailable: number}} nmol/L
 */
function vermeulen(testosterone, shbg, albumin) {
  const t = testosterone * 1e-9;
  const s = shbg * 1e-9;
  const n = 1 + (KA * albumin) / ALBUMIN_MOLAR_MASS;
  const a = n * KT;
  const b = n + KT * (s - t);
  // Positive root of a*x^2 + b*x - t = 0, in the cancellation-free form.
  const root = Math.sqrt(b * b + 4 * a * t);
  const ft = b >= 0 ? (2 * t) / (b + root) : (-b + root) / (2 * a);
  return { free: ft * 1e9, bioavailable: n * ft * 1e9 };
}

export const formulas = {
  /** glucose (mmol/L) x insulin (uIU/mL) / 22.5 */
  homa_ir([glucose, insulin]) {
    return (glucose * insulin) / 22.5;
  },
  /** total cholesterol - HDL (mmol/L) */
  non_hdl([total, hdl]) {
    return total - hdl;
  },
  /** inputs: testosterone_total, shbg (nmol/L), albumin (g/L) */
  free_testosterone_vermeulen([testosterone, shbg, albumin]) {
    return vermeulen(testosterone, shbg, albumin).free;
  },
  bioavailable_testosterone_vermeulen([testosterone, shbg, albumin]) {
    return vermeulen(testosterone, shbg, albumin).bioavailable;
  },
  /** inputs: ast, alt (U/L), platelets (10^9/L); context.age in years */
  fib4([ast, alt, platelets], context) {
    return (context.age * ast) / (platelets * Math.sqrt(alt));
  },
};

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const SOON_DAYS = 30;

/**
 * @param {object} observation
 * @param {object} def MarkerDef
 * @returns {Range | null}
 */
function effectiveRef(observation, def) {
  if (isNum(observation.ref_low) || isNum(observation.ref_high)) {
    const ref = {};
    if (isNum(observation.ref_low)) ref.low = observation.ref_low;
    if (isNum(observation.ref_high)) ref.high = observation.ref_high;
    return ref;
  }
  return def.ref || null;
}

/**
 * Build a Point from a measured observation.
 * @param {object} observation
 * @param {object} def
 * @returns {object}
 */
function measuredPoint(observation, def) {
  const ref = effectiveRef(observation, def);
  const point = {
    date: observation.date,
    value: observation.value,
    ref,
    status: evaluateStatus(observation.value, observation.comparator, ref, def.optimal),
    derived: false,
  };
  if (observation.comparator) point.comparator = observation.comparator;
  if (observation.source !== undefined) point.source = observation.source;
  if (observation.lab !== undefined) point.lab = observation.lab;
  if (observation.verified !== undefined) point.verified = observation.verified;
  return point;
}

/**
 * Compute due state for a marker.
 * @param {object} def
 * @param {object | null} latest
 * @param {string} today
 * @param {object | null} target plan.json entry for this marker, if any
 * @returns {{state: string, date: string | null}}
 */
function computeDue(def, latest, today, target) {
  const hasInterval = isNum(def.recheck_months);
  if (def.kind === "derived" && !hasInterval) return { state: "none", date: null };
  if (!latest) {
    if (def.kind === "derived") return { state: "none", date: null };
    // Never measured: the deadline, if any, is set in plan.json.
    return { state: "missing", date: target && typeof target.due === "string" ? target.due : null };
  }
  if (!hasInterval) return { state: "none", date: null };
  const date = addMonths(latest.date, def.recheck_months);
  const days = daysBetween(today, date);
  if (days < 0) return { state: "overdue", date };
  if (days <= SOON_DAYS) return { state: "soon", date };
  return { state: "ok", date };
}

const PRIORITIES = ["high", "medium", "low"];
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Priority of a marker: the plan target decides; without one it follows the status.
 * @param {object | null} target
 * @param {string} status
 * @returns {"high" | "medium" | "low"}
 */
function computePriority(target, status) {
  if (target && PRIORITIES.includes(target.priority)) return target.priority;
  if (status === "out") return "high";
  if (status === "watch" || status === "nodata") return "medium";
  return "low";
}

/**
 * Urgency bucket for a number of days left.
 * @param {number | null} daysLeft
 * @returns {"overdue" | "week" | "month" | "later" | "none"}
 */
function urgencyFor(daysLeft) {
  if (daysLeft === null) return "none";
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "week";
  if (daysLeft <= 30) return "month";
  return "later";
}

const nonEmptyText = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);

/**
 * @param {{profile: object, goals: object, catalog: object, observations: object[], plan?: object | null, today: string}} input
 * @returns {object} Model
 */
export function buildModel({ profile, goals, catalog, observations, plan: targets, today }) {
  const defs = catalog.markers || [];
  const targetItems = targets && targets.items && typeof targets.items === "object" ? targets.items : {};
  const targetFor = (id) => (targetItems[id] && typeof targetItems[id] === "object" ? targetItems[id] : null);
  const defById = new Map(defs.map((def) => [def.id, def]));

  // 1. Measured points, one per (marker, date); a later line replaces an earlier one.
  const byMarker = new Map(defs.map((def) => [def.id, new Map()]));
  let lastObservationDate = null;
  for (const observation of observations || []) {
    if (!observation || typeof observation.date !== "string") continue;
    if (lastObservationDate === null || observation.date > lastObservationDate) {
      lastObservationDate = observation.date;
    }
    const def = defById.get(observation.marker);
    if (!def || !isNum(observation.value)) continue;
    byMarker.get(def.id).set(observation.date, measuredPoint(observation, def));
  }

  // 2. Derived points, in catalog order (a derived marker may use an earlier derived one).
  for (const def of defs) {
    if (def.kind !== "derived") continue;
    const formula = formulas[def.formula];
    const inputIds = def.inputs || [];
    if (typeof formula !== "function" || inputIds.length === 0) continue;
    const own = byMarker.get(def.id);
    const first = byMarker.get(inputIds[0]);
    if (!first) continue;
    for (const date of first.keys()) {
      if (own.has(date)) continue; // a measured value wins
      const values = [];
      for (const id of inputIds) {
        const point = byMarker.get(id) && byMarker.get(id).get(date);
        if (!point) break;
        values.push(point.value);
      }
      if (values.length !== inputIds.length) continue;
      const value = formula(values, { age: ageAt(profile.birth_date, date) });
      if (!Number.isFinite(value)) continue;
      const ref = def.ref || null;
      own.set(date, {
        date,
        value,
        ref,
        status: evaluateStatus(value, undefined, ref, def.optimal),
        derived: true,
      });
    }
  }

  // 3. Marker states.
  const derivedUsers = new Map(); // input id -> derived marker ids
  for (const def of defs) {
    if (def.kind !== "derived") continue;
    for (const id of def.inputs || []) {
      if (!derivedUsers.has(id)) derivedUsers.set(id, []);
      derivedUsers.get(id).push(def.id);
    }
  }

  const markers = {};
  for (const def of defs) {
    const series = [...byMarker.get(def.id).values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const latest = series.length ? series[series.length - 1] : null;
    const ref = latest ? latest.ref : def.ref || null;
    const status = latest ? latest.status : "nodata";
    const target = targetFor(def.id);
    markers[def.id] = {
      def,
      series,
      latest,
      status,
      ref,
      position: latest ? positionFor(latest.value, ref) : null,
      due: computeDue(def, latest, today, target),
      priority: computePriority(target, status),
      related: def.kind === "derived" ? [...(def.inputs || [])] : [...(derivedUsers.get(def.id) || [])],
    };
  }

  // 4. Domains.
  const domains = (goals.domains || []).map((domain) => {
    const markerIds = defs.filter((def) => def.domain === domain.id).map((def) => def.id);
    const counts = { optimal: 0, watch: 0, out: 0, unrated: 0, nodata: 0 };
    for (const id of markerIds) {
      const state = markers[id];
      if (state.def.role !== "primary") continue;
      counts[state.status] += 1;
    }
    let status;
    if (counts.out > 0) status = "out";
    else if (counts.watch > 0) status = "watch";
    else if (counts.optimal > 0) status = "optimal";
    else if (counts.unrated > 0) status = "unrated";
    else status = "nodata";
    return { id: domain.id, name: domain.name, goal: domain.goal, group: domain.group || null, markerIds, status, counts };
  });

  // 5. Plan. One item per (panel, state, date): markers of a panel that are due
  // on different days are different errands.
  const groups = new Map();
  for (const def of defs) {
    const marker = markers[def.id];
    const { state, date } = marker.due;
    if (state === "none") continue;
    const groupId = def.panel || def.id;
    const key = `${groupId}:${state}:${date || ""}`;
    if (!groups.has(key)) {
      const title = def.panel ? (catalog.panels && catalog.panels[def.panel]) || def.panel : def.name;
      groups.set(key, { key, title, state, date, markerIds: [], priority: "low", effort: null, reason: null, handoff: null });
    }
    const group = groups.get(key);
    group.markerIds.push(def.id);
    if (PRIORITY_ORDER[marker.priority] < PRIORITY_ORDER[group.priority]) group.priority = marker.priority;
    const target = targetFor(def.id);
    if (target) {
      if (group.effort === null) group.effort = nonEmptyText(target.effort);
      if (group.reason === null) group.reason = nonEmptyText(target.reason);
      if (group.handoff === null) group.handoff = nonEmptyText(target.handoff);
    }
  }
  const plan = [...groups.values()]
    .map((group) => {
      const daysLeft = group.date === null ? null : daysBetween(today, group.date);
      return { ...group, daysLeft, urgency: urgencyFor(daysLeft) };
    })
    .sort((a, b) => {
      if (a.date !== b.date) {
        if (a.date === null) return 1;
        if (b.date === null) return -1;
        return a.date < b.date ? -1 : 1;
      }
      if (a.priority !== b.priority) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });

  const domainGroups = Array.isArray(goals.groups) ? goals.groups : [];
  const routine = targets && Array.isArray(targets.routine) ? targets.routine : [];
  const curator = targets && targets.curator && typeof targets.curator === "object" ? targets.curator : null;
  return { mission: goals.mission, groups: domainGroups, today, lastObservationDate, domains, markers, plan, routine, curator };
}
