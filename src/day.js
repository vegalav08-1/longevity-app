// The current day: pure helpers over day.json. No DOM here.
//
// day.json is written by the curator several times a day. It is a layer next to
// the numbers, like the commentary: a broken or absent file never breaks the app.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Nutrients the day screen knows, in display order. */
export const NUTRIENTS = [
  { id: "energy", name: "Калории", unit: "ккал" },
  { id: "protein", name: "Белок", unit: "г" },
  { id: "fat", name: "Жиры", unit: "г" },
  { id: "carbs", name: "Углеводы", unit: "г" },
  { id: "fiber", name: "Клетчатка", unit: "г" },
  { id: "sugar", name: "Сахар", unit: "г" },
  { id: "salt", name: "Соль", unit: "г" },
];

const LIMIT_STATES = new Set(["pending", "kept", "broken"]);

/** An eaten amount: a number or an estimate [low, high]. Returns [low, high] or null. */
export function toSpan(value) {
  if (isNum(value) && value >= 0) return [value, value];
  if (Array.isArray(value) && value.length === 2 && isNum(value[0]) && isNum(value[1])
    && value[0] >= 0 && value[1] >= value[0]) return [value[0], value[1]];
  return null;
}

/** A target: [low | null, high | null] with at least one bound. Returns it or null. */
export function toTarget(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const low = isNum(value[0]) && value[0] >= 0 ? value[0] : null;
  const high = isNum(value[1]) && value[1] >= 0 ? value[1] : null;
  if (low == null && high == null) return null;
  if (low != null && high != null && high < low) return null;
  return [low, high];
}

const strings = (list) => (Array.isArray(list) ? list.filter(isStr).map((s) => s.trim()) : []);

/**
 * Cleans a parsed day.json. Unknown or malformed parts are dropped one by one,
 * so one bad entry does not hide the rest.
 * @returns {object | null} null when the file is not a usable day
 */
export function normaliseDay(raw) {
  if (!isObj(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date))) return null;
  const targets = {};
  if (isObj(raw.targets)) {
    for (const n of NUTRIENTS) {
      const t = toTarget(raw.targets[n.id]);
      if (t) targets[n.id] = t;
    }
  }
  const meals = (Array.isArray(raw.meals) ? raw.meals : []).filter((m) => isObj(m) && isStr(m.title)).map((m) => {
    const meal = { title: m.title.trim(), time: isStr(m.time) ? m.time.trim() : null, text: isStr(m.text) ? m.text.trim() : null };
    for (const n of NUTRIENTS) {
      const s = toSpan(m[n.id]);
      if (s) meal[n.id] = s;
    }
    return meal;
  });
  const options = (Array.isArray(raw.options) ? raw.options : []).filter((o) => isObj(o) && isStr(o.meal)).map((o) => ({
    meal: o.meal.trim(),
    variants: (Array.isArray(o.variants) ? o.variants : []).filter((v) => isObj(v) && isStr(v.text)).map((v) => ({
      text: v.text.trim(),
      energy: isNum(v.energy) ? v.energy : null,
      protein: isNum(v.protein) ? v.protein : null,
      fiber: isNum(v.fiber) ? v.fiber : null,
    })),
  })).filter((o) => o.variants.length);
  const limits = (Array.isArray(raw.limits) ? raw.limits : []).filter((l) => isObj(l) && isStr(l.title)).map((l) => ({
    title: l.title.trim(),
    limit: isStr(l.limit) ? l.limit.trim() : null,
    why: isStr(l.why) ? l.why.trim() : null,
    state: LIMIT_STATES.has(l.state) ? l.state : "pending",
  }));
  const todo = (Array.isArray(raw.todo) ? raw.todo : []).filter((t) => isObj(t) && isStr(t.text))
    .map((t) => ({ text: t.text.trim(), done: t.done === true }));
  const ahead = (Array.isArray(raw.ahead) ? raw.ahead : []).filter((a) => isObj(a) && isStr(a.when) && isStr(a.what))
    .map((a) => ({ when: a.when.trim(), what: a.what.trim(), prep: isStr(a.prep) ? a.prep.trim() : null }));
  const pairs = (list) => (Array.isArray(list) ? list : []).filter((f) => isObj(f) && isStr(f.title))
    .map((f) => ({ title: f.title.trim(), text: isStr(f.text) ? f.text.trim() : null, time: isStr(f.time) ? f.time.trim() : null }));
  return {
    date: raw.date,
    updated: isStr(raw.updated) ? raw.updated.trim() : null,
    headline: isStr(raw.headline) ? raw.headline.trim() : null,
    targets, meals, options, limits, todo,
    tomorrow: strings(raw.tomorrow),
    ahead,
    facts: pairs(raw.facts),
    events: pairs(raw.events),
  };
}

/** Sums every nutrient over the meals. A nutrient no meal reports is null. */
export function dayTotals(day) {
  const totals = {};
  for (const n of NUTRIENTS) {
    let low = 0, high = 0, seen = false;
    for (const meal of day.meals) {
      const s = meal[n.id];
      if (!s) continue;
      seen = true;
      low += s[0];
      high += s[1];
    }
    totals[n.id] = seen ? [low, high] : null;
  }
  return totals;
}

/**
 * Where an eaten amount stands against its target.
 *   under   the floor is not reached yet            -> left: how much is missing
 *   near    the estimate straddles the floor        -> left: [0, worst case]
 *   within  inside the target                        -> room: what is left under the ceiling, if there is one
 *   edge    the estimate straddles the ceiling      -> over: [0, worst case]
 *   over    above the ceiling                        -> over: by how much
 * @param {[number, number] | null} total
 * @param {[number | null, number | null]} target
 */
export function meterState(total, target) {
  const [eatenLow, eatenHigh] = total || [0, 0];
  const [floor, ceiling] = target;
  if (ceiling != null && eatenLow > ceiling) {
    return { state: "over", over: [eatenLow - ceiling, eatenHigh - ceiling] };
  }
  if (floor != null && eatenHigh < floor) {
    const top = ceiling != null ? ceiling : floor;
    return { state: "under", left: [floor - eatenHigh, top - eatenLow] };
  }
  if (ceiling != null && eatenHigh > ceiling) {
    return { state: "edge", over: [0, eatenHigh - ceiling] };
  }
  if (floor != null && eatenLow < floor) {
    return { state: "near", left: [0, floor - eatenLow] };
  }
  return { state: "within", room: ceiling != null ? [ceiling - eatenHigh, ceiling - eatenLow] : null };
}

const intFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "2 100" for whole numbers, "6,5" for fractions below ten: a tenth of a gram matters only there. */
export function formatAmount(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) || rounded >= 10 ? intFmt.format(Math.round(rounded)) : decFmt.format(rounded);
}

/** "1 430–1 655" or "836" for a span; "2 100–2 200", "от 30", "до 25" for a target. */
export function formatSpan(span) {
  const [low, high] = span;
  if (low == null) return "до " + formatAmount(high);
  if (high == null) return "от " + formatAmount(low);
  // one precision for both ends: "10–29", not "9,7–29"
  const whole = high >= 10;
  const a = whole ? formatAmount(Math.round(low)) : formatAmount(low);
  const b = whole ? formatAmount(Math.round(high)) : formatAmount(high);
  return a === b ? a : a + "–" + b;
}
