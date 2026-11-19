import test from "node:test";
import assert from "node:assert/strict";
import { normaliseDay, dayTotals, meterState, toSpan, toTarget, formatSpan, formatAmount } from "../src/day.js";

const sample = () => ({
  version: 1, date: "2031-03-04", updated: "14:10", headline: "Половина дня",
  targets: { energy: [2000, 2200], protein: [120, 160], fiber: [30, null], sugar: [null, 25], bogus: [1, 2] },
  meals: [
    { time: "08:30", title: "Завтрак", energy: [500, 600], protein: 40, fiber: [5, 7], sugar: 10 },
    { time: "13:00", title: "Обед", text: "суп и хлеб", energy: 700, protein: [30, 35] },
    { time: "15:00", energy: 100 },
    "not a meal",
  ],
  options: [{ meal: "Ужин", variants: [{ text: "крупа и овощи", energy: 500, protein: 30, fiber: 12 }, { energy: 1 }] }, { meal: "Пусто", variants: [] }],
  limits: [{ title: "Кофе", limit: "до 14:00", state: "kept" }, { title: "Сладкое", state: "wrong" }, { limit: "без названия" }],
  todo: [{ text: "Взвеситься", done: true }, { text: "Позвонить" }],
  tomorrow: ["Сдать кровь", "", 5],
  ahead: [{ when: "пн", what: "Анализ", prep: "натощак" }, { when: "вт" }],
  facts: [{ title: "Сон", text: "7 часов" }],
  events: [{ time: "19:40", title: "Головная боль", text: "после перерыва в еде" }],
});

test("spans and targets accept only well-formed values", () => {
  assert.deepEqual(toSpan(5), [5, 5]);
  assert.deepEqual(toSpan([1, 3]), [1, 3]);
  assert.equal(toSpan([3, 1]), null);
  assert.equal(toSpan(-1), null);
  assert.equal(toSpan("5"), null);
  assert.deepEqual(toTarget([null, 25]), [null, 25]);
  assert.deepEqual(toTarget([30, null]), [30, null]);
  assert.equal(toTarget([null, null]), null);
  assert.equal(toTarget([5, 1]), null);
});

test("a day is cleaned entry by entry", () => {
  const day = normaliseDay(sample());
  assert.equal(day.date, "2031-03-04");
  assert.deepEqual(Object.keys(day.targets), ["energy", "protein", "fiber", "sugar"]);
  assert.equal(day.meals.length, 2);
  assert.deepEqual(day.meals[0].protein, [40, 40]);
  assert.equal(day.options.length, 1);
  assert.equal(day.options[0].variants.length, 1);
  assert.deepEqual(day.limits.map((l) => l.state), ["kept", "pending"]);
  assert.deepEqual(day.todo.map((t) => t.done), [true, false]);
  assert.deepEqual(day.tomorrow, ["Сдать кровь"]);
  assert.equal(day.ahead.length, 1);
  assert.equal(day.events[0].time, "19:40");
});

test("a file that is not a day gives null", () => {
  assert.equal(normaliseDay(null), null);
  assert.equal(normaliseDay([]), null);
  assert.equal(normaliseDay({ date: "вчера" }), null);
  const empty = normaliseDay({ date: "2031-03-04" });
  assert.deepEqual(empty.meals, []);
  assert.deepEqual(empty.targets, {});
});

test("totals sum the estimates and skip what no meal reports", () => {
  const totals = dayTotals(normaliseDay(sample()));
  assert.deepEqual(totals.energy, [1200, 1300]);
  assert.deepEqual(totals.protein, [70, 75]);
  assert.deepEqual(totals.fiber, [5, 7]);
  assert.equal(totals.fat, null);
});

test("meter states follow the floor and the ceiling", () => {
  assert.deepEqual(meterState([1200, 1300], [2000, 2200]), { state: "under", left: [700, 1000] });
  assert.deepEqual(meterState([1950, 2050], [2000, 2200]), { state: "near", left: [0, 50] });
  assert.deepEqual(meterState([2050, 2150], [2000, 2200]), { state: "within", room: [50, 150] });
  assert.deepEqual(meterState([2150, 2300], [2000, 2200]), { state: "edge", over: [0, 100] });
  assert.deepEqual(meterState([2300, 2500], [2000, 2200]), { state: "over", over: [100, 300] });
  assert.deepEqual(meterState(null, [30, null]), { state: "under", left: [30, 30] });
  assert.deepEqual(meterState([40, 45], [30, null]), { state: "within", room: null });
  assert.deepEqual(meterState([10, 10], [null, 25]), { state: "within", room: [15, 15] });
  assert.deepEqual(meterState([30, 30], [null, 25]), { state: "over", over: [5, 5] });
});

test("amounts are written the Russian way", () => {
  assert.equal(formatAmount(6.04), "6");
  assert.equal(formatAmount(6.5), "6,5");
  assert.equal(formatSpan([836, 836]), "836");
  assert.equal(formatSpan([30, null]), "от 30");
  assert.equal(formatSpan([null, 25]), "до 25");
  assert.match(formatSpan([1430, 1655]), /^1.430–1.655$/);
});
