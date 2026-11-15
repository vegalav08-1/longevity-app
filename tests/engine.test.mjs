import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonl,
  ageAt,
  formatValue,
  evaluateStatus,
  positionFor,
  addMonths,
  formulas,
  buildModel,
} from "../src/engine.js";

const close = (actual, expected, tolerance, label = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected} +-${tolerance}, got ${actual}`,
  );

// ---------------------------------------------------------------- formulas

test("formulas: Vermeulen reference values", () => {
  const inputs = [20, 35, 43];
  close(formulas.free_testosterone_vermeulen(inputs, {}), 0.4152, 0.001, "free");
  close(formulas.bioavailable_testosterone_vermeulen(inputs, {}), 9.731, 0.02, "bioavailable");
});

test("formulas: FIB-4 reference value", () => {
  close(formulas.fib4([30, 25, 250], { age: 40 }), 0.96, 0.005);
});

test("formulas: HOMA-IR reference value", () => {
  close(formulas.homa_ir([5.0, 10]), 2.222, 0.001);
});

test("formulas: non-HDL", () => {
  close(formulas.non_hdl([5.2, 1.4]), 3.8, 1e-9);
});

// ---------------------------------------------------------- evaluateStatus

test("evaluateStatus: optimal, watch, out", () => {
  const ref = { low: 1, high: 10 };
  const optimal = { low: 3, high: 6 };
  assert.equal(evaluateStatus(4, undefined, ref, optimal), "optimal");
  assert.equal(evaluateStatus(8, undefined, ref, optimal), "watch");
  assert.equal(evaluateStatus(2, undefined, ref, optimal), "watch");
  assert.equal(evaluateStatus(11, undefined, ref, optimal), "out");
  assert.equal(evaluateStatus(0.5, undefined, ref, optimal), "out");
});

test("evaluateStatus: unrated without bounds", () => {
  assert.equal(evaluateStatus(5, undefined, null, null), "unrated");
  assert.equal(evaluateStatus(5, undefined, {}, {}), "unrated");
});

test("evaluateStatus: only ref or only optimal", () => {
  assert.equal(evaluateStatus(5, undefined, { high: 10 }, null), "optimal");
  assert.equal(evaluateStatus(12, undefined, { high: 10 }, null), "out");
  assert.equal(evaluateStatus(5, undefined, null, { high: 4 }), "watch");
});

test("evaluateStatus: bounds are inclusive", () => {
  const ref = { low: 1, high: 10 };
  const optimal = { low: 3, high: 6 };
  assert.equal(evaluateStatus(10, undefined, ref, null), "optimal");
  assert.equal(evaluateStatus(1, undefined, ref, null), "optimal");
  assert.equal(evaluateStatus(6, undefined, ref, optimal), "optimal");
  assert.equal(evaluateStatus(3, undefined, ref, optimal), "optimal");
});

test("evaluateStatus: comparator < checks only high bounds", () => {
  // "<3.2" against a high bound of 5: inside; against a high bound of 3: out
  assert.equal(evaluateStatus(3.2, "<", { high: 5 }, null), "optimal");
  assert.equal(evaluateStatus(3.2, "<", { high: 3 }, null), "out");
  // low bound is treated as satisfied even though the value is under it
  assert.equal(evaluateStatus(0.5, "<", { low: 1 }, null), "optimal");
  assert.equal(evaluateStatus(0.5, "<", { low: 1, high: 5 }, { low: 2, high: 4 }), "optimal");
  assert.equal(evaluateStatus(4.5, "<", { low: 1, high: 5 }, { low: 2, high: 4 }), "watch");
});

test("evaluateStatus: comparator > mirrors <", () => {
  assert.equal(evaluateStatus(100, ">", { low: 50 }, null), "optimal");
  assert.equal(evaluateStatus(40, ">", { low: 50 }, null), "out");
  assert.equal(evaluateStatus(100, ">", { high: 10 }, null), "optimal");
  assert.equal(evaluateStatus(100, ">", { low: 50, high: 200 }, { low: 120 }), "watch");
});

// -------------------------------------------------------------- positionFor

test("positionFor: both bounds", () => {
  close(positionFor(1, { low: 1, high: 3 }), 0.25, 1e-9);
  close(positionFor(3, { low: 1, high: 3 }), 0.75, 1e-9);
  close(positionFor(2, { low: 1, high: 3 }), 0.5, 1e-9);
});

test("positionFor: only high", () => {
  close(positionFor(5, { high: 10 }), 0.5, 1e-9);
  close(positionFor(10, { high: 10 }), 0.75, 1e-9);
});

test("positionFor: only low", () => {
  close(positionFor(4, { low: 4 }), 0.25, 1e-9);
  close(positionFor(8, { low: 4 }), 0.75, 1e-9);
});

test("positionFor: degenerate high === low", () => {
  assert.equal(positionFor(3, { low: 5, high: 5 }), 0.5);
  assert.equal(positionFor(5, { low: 5, high: 5 }), 0.5);
  assert.equal(positionFor(6, { low: 5, high: 5 }), 0.9);
});

test("positionFor: clamps to 0.04..0.96", () => {
  assert.equal(positionFor(-100, { low: 1, high: 3 }), 0.04);
  assert.equal(positionFor(100, { low: 1, high: 3 }), 0.96);
  assert.equal(positionFor(100, { high: 10 }), 0.96);
});

test("positionFor: null ref", () => {
  assert.equal(positionFor(5, null), null);
  assert.equal(positionFor(5, undefined), null);
  assert.equal(positionFor(5, {}), null);
});

// --------------------------------------------------------------- addMonths

test("addMonths: simple, clamp, rollover", () => {
  assert.equal(addMonths("2026-03-15", 6), "2026-09-15");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonths("2026-12-10", 1), "2027-01-10");
  assert.equal(addMonths("2026-06-10", 24), "2028-06-10");
  assert.equal(addMonths("2026-06-10", 0), "2026-06-10");
});

// -------------------------------------------------------------------- ageAt

test("ageAt: before and after the birthday", () => {
  assert.equal(ageAt("1986-06-15", "2026-06-14"), 39);
  assert.equal(ageAt("1986-06-15", "2026-06-15"), 40);
  assert.equal(ageAt("1986-06-15", "2026-12-31"), 40);
  assert.equal(ageAt("1986-06-15", "2026-01-01"), 39);
});

// ---------------------------------------------------------------- parseJsonl

test("parseJsonl: skips blank lines", () => {
  const rows = parseJsonl('{"a":1}\n\n   \n{"a":2}\r\n');
  assert.deepEqual(rows, [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseJsonl(""), []);
});

test("parseJsonl: error names the line number", () => {
  assert.throws(() => parseJsonl('{"a":1}\n\n{broken}\n'), /line 3/);
});

// -------------------------------------------------------------- formatValue

test("formatValue: decimals, comma, comparator", () => {
  assert.equal(formatValue(12.296, 2), "12,30");
  assert.equal(formatValue(5, 1), "5,0");
  assert.equal(formatValue(7, 0), "7");
  assert.equal(formatValue(3.2, 1, "<"), "<3,2");
  assert.equal(formatValue(10, 0, ">"), ">10");
  assert.equal(formatValue(4.25, undefined), "4,25");
  assert.equal(formatValue(4, undefined), "4");
});

// ----------------------------------------------------------------- buildModel

const profile = { version: 1, birth_date: "1986-06-15", sex: "male" };
const goals = {
  version: 1,
  mission: "Test mission",
  domains: [
    { id: "metabolic", name: "Metabolic", goal: "Stay lean" },
    { id: "liver", name: "Liver", goal: "Healthy liver" },
    { id: "empty", name: "Empty", goal: "No data" },
  ],
};
const catalog = {
  version: 1,
  panels: { lipids: "Lipid panel", liver_panel: "Liver panel", glucose_panel: "Glucose panel" },
  markers: [
    // measured, primary, with panel and recheck
    { id: "glucose", name: "Glucose", unit: "mmol/L", domain: "metabolic", panel: "glucose_panel",
      role: "primary", kind: "measured", decimals: 1, recheck_months: 6,
      ref: { low: 3.9, high: 5.9 }, optimal: { low: 4.0, high: 5.2 } },
    { id: "insulin", name: "Insulin", unit: "uIU/mL", domain: "metabolic", panel: "glucose_panel",
      role: "primary", kind: "measured", decimals: 1, recheck_months: 6, ref: { high: 25 }, optimal: { high: 8 } },
    { id: "homa", name: "HOMA-IR", unit: "", domain: "metabolic", role: "primary", kind: "derived",
      formula: "homa_ir", inputs: ["glucose", "insulin"], decimals: 2, ref: { high: 2.7 }, optimal: { high: 1.5 } },
    // secondary: out of range but must not affect the domain
    { id: "uric", name: "Uric acid", unit: "umol/L", domain: "metabolic", role: "secondary",
      kind: "measured", decimals: 0, recheck_months: null, ref: { high: 400 } },
    // liver domain
    { id: "ast", name: "AST", unit: "U/L", domain: "liver", panel: "liver_panel", role: "primary",
      kind: "measured", decimals: 0, recheck_months: 12, ref: { high: 40 } },
    { id: "alt", name: "ALT", unit: "U/L", domain: "liver", panel: "liver_panel", role: "primary",
      kind: "measured", decimals: 0, recheck_months: 12, ref: { high: 41 } },
    { id: "platelets", name: "Platelets", unit: "10^9/L", domain: "liver", panel: "liver_panel",
      role: "primary", kind: "measured", decimals: 0, recheck_months: 12, ref: { low: 150, high: 400 } },
    { id: "fib4", name: "FIB-4", unit: "", domain: "liver", role: "primary", kind: "derived",
      formula: "fib4", inputs: ["ast", "alt", "platelets"], decimals: 2, ref: { high: 1.3 } },
    // no data at all, no panel
    { id: "vitd", name: "Vitamin D", unit: "ng/mL", domain: "empty", role: "primary",
      kind: "measured", decimals: 0, recheck_months: 12, ref: { low: 30 } },
    // no bounds, recheck null
    { id: "mystery", name: "Mystery", unit: "", domain: "empty", role: "primary",
      kind: "measured", decimals: 0, recheck_months: null },
    // derived without inputs available and without recheck
    { id: "nonhdl", name: "Non-HDL", unit: "mmol/L", domain: "empty", role: "secondary",
      kind: "derived", formula: "non_hdl", inputs: ["chol", "hdl"], decimals: 1 },
    { id: "chol", name: "Cholesterol", unit: "mmol/L", domain: "empty", panel: "lipids",
      role: "secondary", kind: "measured", decimals: 1, recheck_months: 12 },
    { id: "hdl", name: "HDL", unit: "mmol/L", domain: "empty", panel: "lipids",
      role: "secondary", kind: "measured", decimals: 1, recheck_months: 12 },
  ],
};

const obs = (date, marker, value, extra = {}) => ({
  date, marker, value, unit: "", verified: true, ...extra,
});

function model(observations, today = "2026-11-15", cat = catalog) {
  return buildModel({ profile, goals, catalog: cat, observations, today });
}

test("buildModel: basics and unknown markers", () => {
  const m = model([
    obs("2026-05-01", "glucose", 5.0),
    obs("2026-05-01", "no_such_marker", 99),
  ]);
  assert.equal(m.mission, "Test mission");
  assert.equal(m.today, "2026-11-15");
  assert.equal(m.lastObservationDate, "2026-05-01");
  assert.deepEqual(Object.keys(m.markers).sort(), catalog.markers.map((d) => d.id).sort());
  assert.deepEqual(m.domains.map((d) => d.id), ["metabolic", "liver", "empty"]);
  assert.equal(model([]).lastObservationDate, null);
});

test("buildModel: series sorted, latest, status, position", () => {
  const m = model([
    obs("2026-05-01", "glucose", 5.5),
    obs("2025-05-01", "glucose", 4.5),
  ]);
  const g = m.markers.glucose;
  assert.deepEqual(g.series.map((p) => p.date), ["2025-05-01", "2026-05-01"]);
  assert.equal(g.latest.value, 5.5);
  assert.equal(g.status, "watch");
  assert.equal(g.series[0].status, "optimal");
  assert.deepEqual(g.ref, { low: 3.9, high: 5.9 });
  assert.ok(g.position > 0.25 && g.position < 0.75);
});

test("buildModel: observation ref overrides def.ref", () => {
  const m = model([obs("2026-05-01", "glucose", 5.5, { ref_low: 4.0, ref_high: 5.0 })]);
  const g = m.markers.glucose;
  assert.deepEqual(g.latest.ref, { low: 4.0, high: 5.0 });
  assert.deepEqual(g.ref, { low: 4.0, high: 5.0 });
  assert.equal(g.status, "out");
});

test("buildModel: marker with no data has def.ref and nodata status", () => {
  const m = model([]);
  assert.equal(m.markers.vitd.status, "nodata");
  assert.equal(m.markers.vitd.latest, null);
  assert.deepEqual(m.markers.vitd.ref, { low: 30 });
  assert.equal(m.markers.vitd.position, null);
  assert.equal(m.markers.mystery.ref, null);
});

test("buildModel: comparator observation", () => {
  const m = model([obs("2026-05-01", "insulin", 2.0, { comparator: "<" })]);
  assert.equal(m.markers.insulin.latest.comparator, "<");
  assert.equal(m.markers.insulin.status, "optimal");
});

test("buildModel: derived point is computed from same-date inputs", () => {
  const m = model([
    obs("2026-05-01", "glucose", 5.0),
    obs("2026-05-01", "insulin", 10),
  ]);
  const h = m.markers.homa;
  assert.equal(h.series.length, 1);
  assert.equal(h.latest.derived, true);
  close(h.latest.value, 2.222, 0.001);
  assert.deepEqual(h.latest.ref, { high: 2.7 });
  assert.equal(h.status, "watch"); // above optimal 1.5, inside ref 2.7
});

test("buildModel: FIB-4 uses age on the sampling date", () => {
  const m = model([
    obs("2026-05-01", "ast", 30),
    obs("2026-05-01", "alt", 25),
    obs("2026-05-01", "platelets", 250),
  ]);
  const age = ageAt(profile.birth_date, "2026-05-01");
  close(m.markers.fib4.latest.value, (age * 30) / (250 * 5), 1e-9);
});

test("buildModel: derived not computed when an input is missing or on another date", () => {
  const m = model([
    obs("2026-05-01", "glucose", 5.0),
    obs("2026-06-01", "insulin", 10),
  ]);
  assert.equal(m.markers.homa.series.length, 0);
  assert.equal(m.markers.homa.status, "nodata");
});

test("buildModel: measured value of a derived marker wins on the same date", () => {
  const m = model([
    obs("2026-05-01", "glucose", 5.0),
    obs("2026-05-01", "insulin", 10),
    obs("2026-05-01", "homa", 1.0),
    obs("2026-06-01", "glucose", 5.0),
    obs("2026-06-01", "insulin", 10),
  ]);
  const series = m.markers.homa.series;
  assert.equal(series.length, 2);
  assert.equal(series[0].derived, false);
  assert.equal(series[0].value, 1.0);
  assert.equal(series[1].derived, true);
});

test("buildModel: non-finite derived result produces no point", () => {
  // platelets = 0 gives Infinity
  const m = model([
    obs("2026-05-01", "ast", 30),
    obs("2026-05-01", "alt", 25),
    obs("2026-05-01", "platelets", 0),
  ]);
  assert.equal(m.markers.fib4.series.length, 0);
});

test("buildModel: related markers", () => {
  const m = model([]);
  assert.deepEqual(m.markers.homa.related, ["glucose", "insulin"]);
  assert.deepEqual(m.markers.glucose.related, ["homa"]);
  assert.deepEqual(m.markers.uric.related, []);
});

test("buildModel: domain status is the worst primary status", () => {
  const m = model([
    obs("2026-05-01", "glucose", 5.5), // watch
    obs("2026-05-01", "insulin", 6), // optimal
    obs("2026-05-01", "uric", 900), // secondary, out: ignored
  ]);
  const d = m.domains[0];
  assert.equal(d.status, "watch");
  assert.deepEqual(d.counts, { optimal: 2, watch: 1, out: 0, unrated: 0, nodata: 0 }); // homa = 1.47 is derived
  assert.deepEqual(d.markerIds, ["glucose", "insulin", "homa", "uric"]);

  const worse = model([obs("2026-05-01", "glucose", 7)]);
  assert.equal(worse.domains[0].status, "out");
});

test("buildModel: domain ignores unrated, nodata when no primary data", () => {
  const m = model([
    obs("2026-05-01", "mystery", 3), // unrated primary
    obs("2026-05-01", "chol", 5), // secondary, no bounds
  ]);
  const empty = m.domains[2];
  assert.equal(empty.counts.unrated, 1);
  assert.equal(empty.status, "unrated"); // only unrated primary data
  assert.equal(model([]).domains[2].status, "nodata");
  // unrated does not hide a rated marker
  const mixed = model([obs("2026-05-01", "mystery", 3), obs("2026-05-01", "vitd", 20)]);
  assert.equal(mixed.domains[2].status, "out");
  const good = model([obs("2026-05-01", "mystery", 3), obs("2026-05-01", "vitd", 50)]);
  assert.equal(good.domains[2].status, "optimal");
});

test("buildModel: due states", () => {
  const today = "2026-11-15";
  const at = (date) => model([obs(date, "glucose", 5.0)], today).markers.glucose.due;
  // recheck 6 months
  assert.deepEqual(at("2026-05-01"), { state: "overdue", date: "2026-11-01" });
  assert.deepEqual(at("2026-05-15"), { state: "soon", date: "2026-11-15" }); // due today
  assert.deepEqual(at("2026-06-14"), { state: "soon", date: "2026-12-14" }); // 29 days
  assert.deepEqual(at("2026-06-15"), { state: "soon", date: "2026-12-15" }); // 30 days
  assert.deepEqual(at("2026-06-16"), { state: "ok", date: "2026-12-16" }); // 31 days
  // no data
  assert.deepEqual(model([], today).markers.glucose.due, { state: "missing", date: null });
  // data but recheck null
  const m = model([obs("2026-05-01", "uric", 300)], today);
  assert.deepEqual(m.markers.uric.due, { state: "none", date: null });
  // no data and recheck null: missing by contract
  assert.equal(model([], today).markers.uric.due.state, "missing");
});

test("buildModel: derived markers are never missing", () => {
  const m = model([]);
  assert.equal(m.markers.homa.due.state, "none"); // no recheck_months
  assert.equal(m.markers.nonhdl.due.state, "none");
  assert.notEqual(m.markers.fib4.due.state, "missing");
});

test("buildModel: derived with recheck_months and no data is not missing", () => {
  const cat = {
    ...catalog,
    markers: catalog.markers.map((d) => (d.id === "homa" ? { ...d, recheck_months: 6 } : d)),
  };
  assert.equal(model([], "2026-11-15", cat).markers.homa.due.state, "none");
  const withData = model(
    [obs("2026-01-01", "glucose", 5), obs("2026-01-01", "insulin", 10)],
    "2026-11-15",
    cat,
  );
  assert.equal(withData.markers.homa.due.state, "overdue");
});

test("buildModel: plan grouping, exclusion and ordering", () => {
  const m = model(
    [
      // glucose panel overdue (latest of the two decides per marker, group date = earliest)
      obs("2026-01-10", "glucose", 5.0), // due 2026-07-10 overdue
      obs("2026-02-10", "insulin", 6), // due 2026-08-10 overdue
      // liver panel soon
      obs("2025-12-01", "ast", 20), // due 2026-12-01 soon
      obs("2025-12-20", "alt", 20), // due 2026-12-20 ok (35 days)
      obs("2025-12-01", "platelets", 250), // due 2026-12-01 soon
      // uric: recheck null, has data: excluded
      obs("2026-05-01", "uric", 300),
    ],
    "2026-11-15",
  );
  const plan = m.plan;
  const keys = plan.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");

  assert.deepEqual(
    plan.map((p) => [p.title, p.state]),
    [
      ["Glucose panel", "overdue"],
      ["Liver panel", "soon"],
      ["Lipid panel", "missing"],
      ["Mystery", "missing"],
      ["Vitamin D", "missing"],
      ["Liver panel", "ok"],
    ],
  );
  assert.equal(plan[0].date, "2026-07-10");
  assert.deepEqual(plan[0].markerIds, ["glucose", "insulin"]);
  assert.equal(plan[1].date, "2026-12-01");
  assert.deepEqual(plan[1].markerIds, ["ast", "platelets"]);
  assert.equal(plan[5].date, "2026-12-20");
  assert.deepEqual(plan[5].markerIds, ["alt"]);
  // uric (none) and derived markers (none) never appear
  assert.ok(!plan.some((p) => p.markerIds.includes("uric")));
  assert.ok(!plan.some((p) => p.markerIds.includes("homa")));
  // missing groups have no date and are ordered by title
  assert.equal(plan[2].date, null);
  assert.deepEqual(plan[2].markerIds, ["chol", "hdl"]);
});

test("buildModel: plan sorts by date then title inside a state", () => {
  const cat = {
    version: 1,
    panels: {},
    markers: [
      { id: "b", name: "Bravo", unit: "", domain: "d", role: "primary", kind: "measured", recheck_months: 12 },
      { id: "a", name: "Alpha", unit: "", domain: "d", role: "primary", kind: "measured", recheck_months: 12 },
      { id: "c", name: "Charlie", unit: "", domain: "d", role: "primary", kind: "measured", recheck_months: 12 },
    ],
  };
  const g = { version: 1, mission: "m", domains: [{ id: "d", name: "D", goal: "g" }] };
  const m = buildModel({
    profile,
    goals: g,
    catalog: cat,
    today: "2026-11-15",
    observations: [
      obs("2025-01-01", "b", 1),
      obs("2025-01-01", "a", 1),
      obs("2025-03-01", "c", 1),
      obs("2025-12-01", "a", 1), // later point for a: due 2026-12-01 -> soon
    ],
  });
  // b overdue 2026-01-01; c overdue 2026-03-01; a soon
  assert.deepEqual(m.plan.map((p) => p.title), ["Bravo", "Charlie", "Alpha"]);

  const m2 = buildModel({
    profile, goals: g, catalog: cat, today: "2026-11-15",
    observations: [obs("2025-01-01", "b", 1), obs("2025-01-01", "a", 1)],
  });
  // same date: title ascending; c missing comes after the overdue ones
  assert.deepEqual(m2.plan.map((p) => [p.title, p.state]), [
    ["Alpha", "overdue"],
    ["Bravo", "overdue"],
    ["Charlie", "missing"],
  ]);
});
