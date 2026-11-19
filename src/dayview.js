// The day screen: what was eaten against the targets, what to eat next, the
// limits set for the day, what to do today and tomorrow, and what lies ahead.
// Everything on it comes from day.json, written by the curator during the day.
import { h, svg, formatDateRu } from "./dom.js";
import { link } from "./route.js";
import { statusIcon } from "./charts.js";
import { NUTRIENTS, dayTotals, meterState, formatSpan, formatAmount } from "./day.js";

const W = 330, TRACK_H = 14, BAR_Y = 4, BAR_H = 6;
const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const LIMIT_WORD = { pending: "в силе", kept: "выдержано", broken: "нарушено" };
const LIMIT_ICON = { pending: "nodata", kept: "optimal", broken: "out" };
const METER_ICON = { within: "optimal", edge: "watch", over: "out" };

const heading = (text, count) => h("h2", null, text, count != null ? h("span", { class: "count" }, String(count)) : null);

function dayTitle(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const weekday = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  // "19 ноября 2026 г." -> "19 ноября"
  return weekday + ", " + formatDateRu(iso).replace(/\s\d{4}\s?г\.?$/, "");
}

// ---- nutrition meters --------------------------------------------------------------

function meterBar(total, target, state) {
  const [eatenLow, eatenHigh] = total || [0, 0];
  const [floor, ceiling] = target;
  const max = Math.max((ceiling != null ? ceiling : floor) * 1.2, eatenHigh * 1.05, 1);
  const x = (value) => Math.min(W, (value / max) * W);
  // The rounded ends come from the stylesheet, so every layer is a plain rectangle.
  const root = svg("svg", { class: "meter-bar mt-" + state, viewBox: `0 0 ${W} ${TRACK_H}`, "aria-hidden": "true", focusable: "false" });
  const zoneFrom = floor != null ? x(floor) : 0;
  const zoneTo = ceiling != null ? x(ceiling) : W;
  root.append(
    svg("rect", { class: "zone zone-edge", x: 0, y: 0, width: W, height: TRACK_H }),
    svg("rect", { class: "zone zone-ref", x: zoneFrom, y: 0, width: Math.max(0, zoneTo - zoneFrom), height: TRACK_H }),
  );
  // The eaten amount is a thinner bar, so the target zone stays visible behind it.
  // Solid is what was eaten for certain, pale is the uncertainty of the estimate;
  // only the part above the ceiling takes the alarm colour.
  const limit = ceiling != null ? ceiling : Infinity;
  const piece = (from, to, cls) => {
    if (to > from) root.append(svg("rect", { class: cls, x: x(from), y: BAR_Y, width: x(to) - x(from), height: BAR_H }));
  };
  piece(0, Math.min(eatenLow, limit), "meter-fill");
  piece(Math.min(eatenLow, limit), Math.min(eatenHigh, limit), "meter-est");
  piece(Math.max(limit, 0), eatenLow, "meter-fill meter-excess");
  piece(Math.max(limit, eatenLow), eatenHigh, "meter-est meter-excess");
  for (const bound of [floor, ceiling]) {
    if (bound != null) root.append(svg("line", { class: "meter-tick", x1: x(bound), x2: x(bound), y1: 0, y2: TRACK_H }));
  }
  return root;
}

function meterNote(result, unit) {
  switch (result.state) {
    case "under": return `осталось ${formatSpan(result.left)} ${unit}`;
    case "near": return "у нижней границы цели";
    case "edge": return "на границе предела";
    case "over": return `выше на ${formatSpan(result.over)} ${unit}`;
    default:
      return result.room && result.room[1] > 0 ? `в пределе, запас ${formatSpan(result.room)} ${unit}` : "в цели";
  }
}

function meter(nutrient, total, target) {
  const eaten = total ? formatSpan(total) : "0";
  if (!target) {
    return h("div", { class: "meter" },
      h("div", { class: "meter-head" },
        h("span", { class: "meter-name" }, nutrient.name),
        h("span", { class: "meter-value" }, `${eaten} ${nutrient.unit}`)));
  }
  const result = meterState(total, target);
  const icon = METER_ICON[result.state];
  return h("div", { class: "meter" },
    h("div", { class: "meter-head" },
      h("span", { class: "meter-name" }, nutrient.name),
      h("span", { class: "meter-value" }, `${eaten} ${nutrient.unit}`)),
    meterBar(total, target, result.state),
    h("div", { class: "meter-foot" },
      h("span", { class: "meter-note" }, icon ? statusIcon(icon) : null, meterNote(result, nutrient.unit)),
      h("span", { class: "meter-target" }, "цель " + formatSpan(target))));
}

function nutrition(day) {
  const totals = dayTotals(day);
  const rows = NUTRIENTS.filter((n) => day.targets[n.id] || totals[n.id])
    .map((n) => meter(n, totals[n.id], day.targets[n.id] || null));
  if (!rows.length) {
    return h("div", { class: "card pad" }, h("p", null, "Еда за этот день ещё не записана."));
  }
  return h("div", { class: "card pad meters" }, ...rows);
}

function meals(day) {
  if (!day.meals.length) return null;
  return h("details", { class: "card day-fold" },
    h("summary", null, h("span", null, "Приёмы пищи"), h("span", { class: "count" }, String(day.meals.length))),
    h("ul", { class: "day-list" }, ...day.meals.map((meal) => h("li", { class: "day-row" },
      h("span", { class: "day-when" }, meal.time || ""),
      h("span", { class: "day-row-body" },
        h("span", { class: "day-row-title" }, meal.title),
        meal.text ? h("span", { class: "day-row-text" }, meal.text) : null),
      meal.energy ? h("span", { class: "day-row-state" }, formatSpan(meal.energy) + " ккал") : null))));
}

// ---- lists -------------------------------------------------------------------------

function variantMeta(v) {
  const parts = [];
  if (v.energy != null) parts.push(`${formatAmount(v.energy)} ккал`);
  if (v.protein != null) parts.push(`белок ${formatAmount(v.protein)} г`);
  if (v.fiber != null) parts.push(`клетчатка ${formatAmount(v.fiber)} г`);
  return parts.join(", ");
}

function options(day) {
  return day.options.map((option) => h("div", { class: "card day-option" },
    h("h3", { class: "day-sub" }, option.meal),
    h("ol", { class: "day-list" }, ...option.variants.map((v, index) => h("li", { class: "day-row" },
      h("span", { class: "day-badge day-num" }, String(index + 1)),
      h("span", { class: "day-row-body" },
        h("span", { class: "day-row-text day-variant" }, v.text),
        variantMeta(v) ? h("span", { class: "day-row-meta" }, variantMeta(v)) : null))))));
}

function limits(day) {
  return h("div", { class: "card" }, h("ul", { class: "day-list" }, ...day.limits.map((l) => h("li", { class: "day-row" },
    h("span", { class: "day-badge st-" + LIMIT_ICON[l.state] }, statusIcon(LIMIT_ICON[l.state])),
    h("span", { class: "day-row-body" },
      h("span", { class: "day-row-title" }, l.title),
      l.limit ? h("span", { class: "day-row-text" }, l.limit) : null,
      l.why ? h("span", { class: "day-row-meta" }, l.why) : null),
    h("span", { class: "day-row-state ls-" + l.state }, LIMIT_WORD[l.state])))));
}

function todo(day) {
  return h("div", { class: "card" }, h("ul", { class: "day-list" }, ...day.todo.map((t) => h("li", { class: t.done ? "day-row is-done" : "day-row" },
    h("span", { class: "day-badge st-" + (t.done ? "optimal" : "nodata") }, statusIcon(t.done ? "optimal" : "nodata")),
    h("span", { class: "day-row-body" }, h("span", { class: "day-row-title" }, t.text)),
    t.done ? h("span", { class: "day-row-state" }, "сделано") : null))));
}

function plainList(items) {
  return h("div", { class: "card" }, h("ul", { class: "day-list" }, ...items.map((text) => h("li", { class: "day-row" },
    h("span", { class: "day-row-body" }, h("span", { class: "day-row-title day-plain" }, text))))));
}

function timedList(items, whenOf) {
  return h("div", { class: "card" }, h("ul", { class: "day-list" }, ...items.map((item) => h("li", { class: "day-row" },
    h("span", { class: "day-when" }, whenOf(item) || ""),
    h("span", { class: "day-row-body" },
      h("span", { class: "day-row-title" }, item.what || item.title),
      item.prep || item.text ? h("span", { class: "day-row-text" }, item.prep || item.text) : null)))));
}

function facts(day) {
  return h("div", { class: "card" }, h("dl", { class: "day-facts" }, ...day.facts.flatMap((f) => [
    h("dt", null, f.title), h("dd", null, f.text || "—"),
  ])));
}

// ---- screen ------------------------------------------------------------------------

/**
 * @param {object} model  model with `day` (normalised day.json) or without it
 * @param {string} today  "YYYY-MM-DD", the device's date
 */
export function dayView(model, today) {
  const day = model && model.day;
  if (!day) {
    return h("div", { class: "screen", "data-title": "День" },
      h("div", { class: "card pad" },
        h("p", null, "Куратор ещё не вёл дневную сводку."),
        h("a", { href: link("") }, "Открыть обзор здоровья")));
  }
  const done = day.limits.filter((l) => l.state === "kept").length;
  return h("div", { class: "screen", "data-title": "День" },
    h("div", { class: "lead day-lead" },
      h("p", { class: "lead-date" }, dayTitle(day.date)),
      day.headline ? h("strong", { class: "lead-headline" }, day.headline) : null,
      day.date !== today
        ? h("p", { class: "day-stale" }, "Это записи за прошлый день: за сегодня куратор ещё ничего не внёс.")
        : null,
      day.updated ? h("p", { class: "lead-by" }, "Обновлено в " + day.updated) : null),
    heading("Питание"),
    nutrition(day),
    meals(day),
    day.options.length ? [heading("Что съесть дальше"), ...options(day)] : null,
    day.limits.length ? [heading("Ограничения на день", `${done} из ${day.limits.length}`), limits(day)] : null,
    day.todo.length ? [heading("Сделать сегодня"), todo(day)] : null,
    day.tomorrow.length ? [heading("Завтра"), plainList(day.tomorrow)] : null,
    day.ahead.length ? [heading("Впереди"), timedList(day.ahead, (a) => a.when)] : null,
    day.events.length ? [heading("События дня"), timedList(day.events, (e) => e.time)] : null,
    day.facts.length ? [heading("За день"), facts(day)] : null);
}
