// One function per screen. Each returns a DOM node (div.screen) carrying
// data-title and, optionally, data-back-href / data-back-label for the router.
//
// The today screen is a three-level disclosure: body systems, then the markers
// of a system, then one marker with its range, the model's comment and a link
// to the full history. Nothing below the first level is in the DOM until it is
// opened.
import { formatValue } from "./engine.js";
import { UI_STATE_KEY } from "./data.js";
import { link } from "./route.js";
import { renderMarkdown } from "./markdown.js";
import { h, formatDateRu, valueText, refText } from "./dom.js";
import { rangeBar, historyChart, statusIcon, domainProfile, shareBar, priorityIcon } from "./charts.js";

const STATUS_WORD = {
  optimal: "В норме", watch: "Внимание", out: "Вне нормы", nodata: "Нет данных", unrated: "Без нормы",
};
const MARKER_TALLY = {
  out: "вне нормы", watch: "внимание", optimal: "в норме", unrated: "без нормы", nodata: "не измерено",
};
const TALLY_ORDER = ["out", "watch", "optimal", "unrated", "nodata"];
// Problems first, then what has never been assessed, then what is fine.
const DOMAIN_ORDER = { out: 0, watch: 1, nodata: 2, unrated: 3, optimal: 4 };
const PRIORITY_WORD = { high: "Высокий", medium: "Средний", low: "Низкий" };
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const URGENCY_SECTIONS = [
  ["overdue", "Просрочено"], ["week", "На этой неделе"], ["month", "В этом месяце"],
  ["later", "Позже"], ["none", "Без срока"],
];

function screen(title, back, ...children) {
  return h("div", {
    class: "screen", "data-title": title,
    "data-back-href": back ? back.href : null, "data-back-label": back ? back.label : null,
  }, ...children);
}

const heading = (text) => h("h2", null, text);
const markerHref = (id) => link(`marker/${encodeURIComponent(id)}`);

function chip(status) {
  return h("span", { class: "chip st-" + status }, statusIcon(status), STATUS_WORD[status] || status);
}

function tally(counts, words) {
  const items = TALLY_ORDER.filter((s) => counts[s] > 0)
    .map((s) => h("span", { class: "tally-item" }, statusIcon(s), `${counts[s]} ${words[s]}`));
  return items.length ? h("div", { class: "tally" }, ...items) : null;
}

// ---- disclosure ----------------------------------------------------------------

// Open sections survive re-renders and navigation to a marker page and back.
const open = new Set();

export function openDomain(id) {
  open.add("d:" + id);
}

function disclosure(key, attrs, summaryChildren, buildBody) {
  const el = h("details", { ...attrs, open: open.has(key) ? true : null },
    h("summary", null, ...summaryChildren));
  let filled = false;
  const fill = () => {
    if (filled) return;
    filled = true;
    el.append(buildBody());
  };
  if (open.has(key)) fill();
  el.addEventListener("toggle", () => {
    if (el.open) { open.add(key); fill(); } else open.delete(key);
  });
  return el;
}

// ---- interface state -----------------------------------------------------------
// Filters live for the session; "sent to the curator" marks live on the device.

const ui = { domains: "all", planPriority: "all", planDate: null };
let rerender = () => {};

export function onStateChange(fn) {
  rerender = fn;
}

// Guest mode never reads or writes localStorage.
function readSent(model) {
  if (model && model.guest) return new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}");
    return new Set(Array.isArray(stored.sent) ? stored.sent : []);
  } catch {
    return new Set();
  }
}

function toggleSent(key) {
  const sent = readSent();
  if (sent.has(key)) sent.delete(key); else sent.add(key);
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ sent: [...sent] }));
  } catch {
    // storage unavailable: the mark simply does not persist
  }
}

function filterBar(label, options, current, pick) {
  return h("div", { class: "filters", role: "group", "aria-label": label },
    ...options.map(([value, text, count]) => h("button", {
      type: "button", class: "filter", "aria-pressed": String(current === value),
      onclick: () => { pick(value); rerender(); },
    }, text, count != null ? h("span", { class: "filter-count" }, String(count)) : null)));
}

// ---- commentary ----------------------------------------------------------------

function note(commentary, text, stale) {
  return h("div", { class: "note" },
    h("div", { class: "note-label" }, "Комментарий"),
    h("p", null, text),
    stale ? h("p", { class: "note-stale" },
      `Написан по данным на ${formatDateRu(commentary.as_of)}. С тех пор появились новые измерения.`) : null);
}

const newerThan = (ms, commentary) => !!(ms && ms.latest && commentary.as_of && ms.latest.date > commentary.as_of);

function markerNote(model, ms) {
  const c = model.commentary;
  const text = c && c.markers && c.markers[ms.def.id];
  return text ? note(c, text, newerThan(ms, c)) : null;
}

function domainNote(model, d) {
  const c = model.commentary;
  const entry = c && c.domains && c.domains[d.id];
  if (!entry || !entry.text) return null;
  return note(c, entry.text, d.markerIds.some((id) => newerThan(model.markers[id], c)));
}

// ---- marker (third level) ------------------------------------------------------

function boundsWords(opt, dec) {
  const lo = opt.low != null ? formatValue(opt.low, dec) : null;
  const hi = opt.high != null ? formatValue(opt.high, dec) : null;
  if (lo != null && hi != null) return `от ${lo} до ${hi}`;
  if (hi != null) return `не выше ${hi}`;
  if (lo != null) return `не ниже ${lo}`;
  return "";
}

function goalText(def) {
  const opt = def.optimal;
  if (!opt || (opt.low == null && opt.high == null)) return null;
  return "Цель: " + boundsWords(opt, def.decimals ?? 0) + (def.unit_label ? " " + def.unit_label : "");
}

function recheckText(ms) {
  const due = ms.due;
  if (due.state === "ok" || due.state === "soon" || due.state === "overdue") {
    return "Следующая сдача: " + formatDateRu(due.date) + (due.state === "overdue" ? ", просрочено" : "");
  }
  if (due.state === "missing") {
    return due.date ? "Ещё не измерялось. Срок первого измерения: " + formatDateRu(due.date) : "Ещё не измерялось.";
  }
  if (ms.def.kind === "derived") return "Считается автоматически из связанных показателей.";
  return ms.def.recheck_note || "Регулярная пересдача не требуется.";
}

function markerBody(model, ms) {
  const def = ms.def;
  const body = h("div", { class: "marker-body" });
  if (ms.latest) {
    body.append(h("div", { class: "m-status" }, chip(ms.status),
      h("span", { class: "muted" }, formatDateRu(ms.latest.date))));
    body.append(rangeBar(ms));
    // The earlier point, so the history is visible without opening the marker screen.
    const prev = ms.series.length > 1 ? ms.series[ms.series.length - 2] : null;
    if (prev) {
      body.append(h("p", { class: "prev-line" },
        h("span", { class: "prev-label" }, "Было: "),
        valueText(prev, def) + ", " + formatDateRu(prev.date),
        ms.series.length > 2 ? h("span", { class: "muted" }, " · всего точек: " + ms.series.length) : null));
    }
    const goal = goalText(def);
    if (goal) body.append(h("p", { class: "goal-line" }, goal));
  }
  const comment = markerNote(model, ms);
  if (comment) body.append(comment);
  if (def.why) body.append(h("p", { class: "what" }, def.why));
  body.append(h("p", { class: "facts" }, recheckText(ms)));
  if (ms.latest) body.append(h("a", { class: "link-more", href: markerHref(def.id) }, "История и детали"));
  return body;
}

function markerItem(model, ms) {
  const def = ms.def;
  return disclosure("m:" + def.id, { class: "marker" }, [
    h("div", { class: "m-line" },
      statusIcon(ms.latest ? ms.status : "nodata"),
      h("span", { class: "m-name" }, def.name,
        ms.latest && ms.latest.derived ? h("span", { class: "suffix" }, "расчёт") : null),
      ms.latest
        ? h("span", { class: "m-value" }, valueText(ms.latest, def))
        : h("span", { class: "m-value none" }, "нет данных")),
    ms.latest ? rangeBar(ms, { compact: true }) : null,
  ], () => markerBody(model, ms));
}

// ---- domain (second level) -----------------------------------------------------

function group(model, title, status, items) {
  if (!items.length) return [];
  return [
    h("div", { class: "group-title" }, statusIcon(status), h("span", null, title),
      h("span", { class: "count" }, String(items.length))),
    ...items.map((ms) => markerItem(model, ms)),
  ];
}

function domainBody(model, d) {
  const all = d.markerIds.map((id) => model.markers[id]).filter(Boolean);
  const primary = all.filter((m) => m.def.role === "primary");
  const flagged = primary.filter((m) => m.latest && (m.status === "out" || m.status === "watch"))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "out" ? -1 : 1));
  const fine = primary.filter((m) => m.latest && !flagged.includes(m));
  const secondary = all.filter((m) => m.def.role !== "primary" && m.latest);
  const unmeasured = all.filter((m) => !m.latest && m.def.kind !== "derived");

  const body = h("div", { class: "domain-body" });
  const comment = domainNote(model, d);
  if (comment) body.append(comment);
  else if (d.goal) body.append(h("p", { class: "goal" }, d.goal));
  body.append(
    ...group(model, "Требуют внимания", flagged.some((m) => m.status === "out") ? "out" : "watch", flagged),
    ...group(model, "В норме", "optimal", fine),
    ...group(model, "Не измерено", "nodata", unmeasured));
  if (secondary.length) {
    body.append(disclosure("s:" + d.id, { class: "subgroup" }, [
      h("span", null, "Дополнительные показатели"),
      h("span", { class: "count" }, String(secondary.length)),
    ], () => h("div", null, ...secondary.map((ms) => markerItem(model, ms)))));
  }
  return body;
}

function domainItem(model, d) {
  const entry = model.commentary && model.commentary.domains && model.commentary.domains[d.id];
  return disclosure("d:" + d.id, { class: "card domain is-" + d.status, id: "domain-" + d.id }, [
    h("div", { class: "domain-head" }, h("span", { class: "domain-name" }, d.name), chip(d.status)),
    entry && entry.headline ? h("div", { class: "domain-headline" }, entry.headline) : null,
    domainProfile(d.markerIds.map((id) => model.markers[id]).filter((m) => m && m.def.role === "primary")),
    tally(d.counts, MARKER_TALLY),
  ], () => domainBody(model, d));
}

// ---- today ---------------------------------------------------------------------

function fallbackHeadline(counts) {
  if (counts.out) return `Вне нормы систем: ${counts.out}`;
  if (counts.watch) return `Требуют внимания систем: ${counts.watch}`;
  return "Отклонений в измеренных системах нет";
}

const POINT_STATUS = new Set(["out", "watch", "optimal", "nodata"]);

// The summary split into scannable points: a status badge, a short bold title,
// one line of text. A point that names a domain opens that domain.
function leadPoints(model, points) {
  if (!Array.isArray(points)) return null;
  const known = new Set(model.domains.map((d) => d.id));
  const rows = points
    .filter((p) => p && typeof p.title === "string" && p.title.trim())
    .map((p) => {
      const status = POINT_STATUS.has(p.status) ? p.status : "nodata";
      const target = typeof p.domain === "string" && known.has(p.domain) ? p.domain : null;
      const inner = [
        h("span", { class: "point-badge st-" + status }, statusIcon(status)),
        h("span", { class: "point-body" },
          h("span", { class: "point-title" }, p.title),
          typeof p.text === "string" && p.text ? h("span", { class: "point-text" }, p.text) : null),
        target ? h("span", { class: "point-go", "aria-hidden": "true" }) : null,
      ];
      return h("li", { class: "point" },
        target ? h("a", { class: "point-row", href: link("domain/" + target) }, ...inner)
               : h("div", { class: "point-row" }, ...inner));
    });
  return rows.length ? h("ul", { class: "points" }, ...rows) : null;
}

function lead(model) {
  const c = model.commentary;
  const counts = {};
  for (const d of model.domains) counts[d.status] = (counts[d.status] || 0) + 1;
  const markerCounts = { optimal: 0, watch: 0, out: 0, unrated: 0, nodata: 0 };
  for (const d of model.domains) for (const k of Object.keys(markerCounts)) markerCounts[k] += d.counts[k] || 0;
  const total = Object.values(markerCounts).reduce((a, b) => a + b, 0);
  const summary = c && c.summary;
  const stale = !!(c && c.as_of && model.lastObservationDate && model.lastObservationDate > c.as_of);
  return h("section", { class: "lead" },
    h("p", { class: "lead-date" },
      model.lastObservationDate ? "Данные на " + formatDateRu(model.lastObservationDate) : "Измерений пока нет"),
    h("h2", { class: "lead-headline" }, summary && summary.headline ? summary.headline : fallbackHeadline(counts)),
    summary && summary.text ? h("p", { class: "lead-text" }, summary.text) : null,
    summary ? leadPoints(model, summary.points) : null,
    total ? h("div", { class: "coverage" },
      h("div", { class: "coverage-title" }, `Измерено ${total - markerCounts.nodata} из ${total} показателей`),
      shareBar(markerCounts),
      tally(markerCounts, MARKER_TALLY)) : null,
    c && c.author ? h("p", { class: "lead-by" },
      `Разбор: ${c.author}` + (c.written ? `, ${formatDateRu(c.written)}` : "") +
      (stale ? ". С тех пор появились новые измерения." : "")) : null);
}

// ---- plan items ----------------------------------------------------------------

const plural = (n, one, few, many) => {
  const d = Math.abs(n) % 100, u = d % 10;
  if (d > 10 && d < 20) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
};

function relativeText(daysLeft) {
  if (daysLeft == null) return null;
  if (daysLeft === 0) return "сегодня";
  if (daysLeft === 1) return "завтра";
  const n = Math.abs(daysLeft);
  const span = n > 45
    ? `${Math.round(n / 30)} ${plural(Math.round(n / 30), "месяц", "месяца", "месяцев")}`
    : `${n} ${plural(n, "день", "дня", "дней")}`;
  return daysLeft < 0 ? `просрочено на ${span}` : `через ${span}`;
}

const parts = (iso) => iso.split("-").map(Number);

function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// A panel title names every marker of the panel. An item that covers one
// marker, or a small part of a panel, is named after what is actually due.
function planTitle(model, item) {
  const states = item.markerIds.map((id) => model.markers[id]).filter(Boolean);
  if (states.length === 1) return states[0].def.name;
  const panel = states[0] && states[0].def.panel;
  const panelSize = Object.values(model.markers).filter((m) => m.def.panel === panel).length;
  if (states.length < panelSize && states.length <= 3) {
    return states.map((m) => m.def.short_name || m.def.name).join(", ");
  }
  return item.title;
}

// The deadline as a calendar leaf, tinted by how close it is.
function dateBlock(model, item) {
  if (!item.date) {
    return h("div", { class: "date-block urg-none", "aria-hidden": "true" }, h("span", { class: "date-day" }, "—"));
  }
  const [y, m, d] = parts(item.date);
  const sameYear = y === parts(model.today)[0];
  return h("div", { class: "date-block urg-" + item.urgency, "aria-hidden": "true" },
    h("span", { class: "date-day" }, String(d)),
    h("span", { class: "date-month" }, MONTHS_SHORT[m - 1] + (sameYear ? "" : " " + String(y).slice(2))));
}

function handoffBlock(text) {
  const button = h("button", { class: "btn btn-small", type: "button" }, "Скопировать");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Скопировано";
    } catch {
      button.textContent = "Выдели текст вручную";
    }
    setTimeout(() => { button.textContent = "Скопировать"; }, 2000);
  });
  return h("div", { class: "handoff" },
    h("div", { class: "handoff-label" }, "Что отправить куратору"),
    h("div", { class: "handoff-text" }, text),
    button);
}

function planBody(model, item, states, isSent) {
  const body = h("div", { class: "plan-body" });
  const reason = item.reason || (states.length === 1 && item.state === "missing" ? states[0].def.why : null);
  if (reason) body.append(h("p", { class: "plan-reason" }, reason));
  if (item.date) {
    body.append(h("p", { class: "facts" },
      (item.state === "missing" ? "Первое измерение до " : "Пересдача до ") + formatDateRu(item.date)));
  }
  const owner = !model.guest;
  if (owner && item.handoff) body.append(handoffBlock(item.handoff));
  if (owner) body.append(h("div", { class: "plan-actions" },
    h("button", {
      class: "btn btn-small" + (isSent ? "" : " btn-primary"), type: "button",
      onclick: () => { toggleSent(item.key); rerender(); },
    }, isSent ? "Снять отметку" : "Отметить: отправлено куратору")));
  if (states.length <= 8) {
    body.append(h("div", { class: "plan-markers" },
      ...states.map((m) => h("a", { class: "mini-link", href: markerHref(m.def.id) }, m.def.short_name || m.def.name))));
  } else {
    body.append(h("p", { class: "facts" }, `Показателей в панели: ${states.length}.`));
  }
  return body;
}

function planItem(model, item, sent) {
  const states = item.markerIds.map((id) => model.markers[id]).filter(Boolean);
  const rel = relativeText(item.daysLeft);
  const isSent = !model.guest && sent.has(item.key);
  return disclosure("p:" + item.key, { class: `card plan-item prio-${item.priority}` + (isSent ? " is-sent" : "") }, [
    dateBlock(model, item),
    h("div", { class: "plan-main" },
      h("div", { class: "plan-title" }, planTitle(model, item)),
      h("div", { class: "plan-chips" },
        h("span", { class: "chip-prio prio-" + item.priority },
          priorityIcon(item.priority), PRIORITY_WORD[item.priority], h("span", { class: "sr" }, " приоритет")),
        rel ? h("span", { class: "chip-rel urg-" + item.urgency }, rel) : null,
        isSent ? h("span", { class: "chip-sent" }, "Отправлено") : null),
      item.effort ? h("div", { class: "plan-effort" }, item.effort) : null),
  ], () => planBody(model, item, states, isSent));
}

export function todayView(model) {
  if (!model) {
    return screen("Сегодня", null,
      h("div", { class: "card pad" },
        h("p", null, "Данные не подключены. Укажите репозиторий с данными и токен доступа."),
        h("a", { class: "btn btn-primary", href: link("settings") }, "Подключить данные")));
  }
  const bySeverity = (list) => list.slice()
    .sort((a, b) => (DOMAIN_ORDER[a.status] ?? 9) - (DOMAIN_ORDER[b.status] ?? 9));
  // Domains are listed under their group; without groups they form one list.
  const known = new Set((model.groups || []).map((g) => g.id));
  const sections = (model.groups || [])
    .map((g) => ({ title: g.name, domains: model.domains.filter((d) => d.group === g.id) }))
    .filter((sec) => sec.domains.length);
  const loose = model.domains.filter((d) => !known.has(d.group));
  if (loose.length) sections.push({ title: "Системы", domains: loose });
  const flaggedCount = model.domains.filter((d) => d.status === "out" || d.status === "watch").length;
  const noDataCount = model.domains.filter((d) => d.status === "nodata").length;
  const visible = (d) => ui.domains === "all"
    || (ui.domains === "flagged" && (d.status === "out" || d.status === "watch"))
    || (ui.domains === "nodata" && d.status === "nodata");
  // The plan is already ordered by deadline, then priority.
  const sent = readSent(model);
  const next = model.plan.filter((i) => i.date).slice(0, 3);
  return screen("Сегодня", null,
    model.mission ? h("p", { class: "mission" }, model.mission) : null,
    lead(model),
    filterBar("Фильтр систем", [
      ["all", "Все", model.domains.length],
      ["flagged", "Требуют внимания", flaggedCount],
      ["nodata", "Без данных", noDataCount],
    ], ui.domains, (value) => { ui.domains = value; }),
    ...sections.flatMap((sec) => {
      const shown = bySeverity(sec.domains).filter(visible);
      return shown.length
        ? [heading(sec.title), h("div", { class: "stack" }, ...shown.map((d) => domainItem(model, d)))]
        : [];
    }),
    heading("Что дальше"),
    next.length
      ? h("div", { class: "stack" }, ...next.map((i) => planItem(model, i, sent)))
      : h("p", { class: "muted" }, "Ближайших измерений нет."),
    h("p", { class: "more" }, h("a", { href: link("plan") }, "Весь план")));
}

// ---- marker page (full detail) -------------------------------------------------

export function markerView(model, id) {
  const ms = model && model.markers[id];
  if (!ms) {
    return screen("Показатель", { href: link(), label: "Назад" },
      h("p", null, "Показатель не найден."), h("p", null, h("a", { href: link() }, "К сводке")));
  }
  const def = ms.def;
  const dec = def.decimals ?? 0;
  const back = { href: link(`domain/${encodeURIComponent(def.domain)}`), label: "Назад" };
  const out = [];
  const comment = markerNote(model, ms);

  if (!ms.latest) {
    out.push(h("div", { class: "card pad" }, chip("nodata"), h("p", { class: "facts" }, "Ещё не измерялось.")));
    if (comment) out.push(comment);
    if (def.why) out.push(heading("Что это"), h("div", { class: "card pad" }, h("p", null, def.why)));
    if (def.basis) out.push(heading("Откуда порог"), h("div", { class: "card pad" }, h("p", null, def.basis)));
    return screen(def.name, back, ...out);
  }

  const head = h("div", { class: "card pad head" },
    h("div", { class: "big" },
      h("span", { class: "big-value" }, formatValue(ms.latest.value, dec, ms.latest.comparator)),
      def.unit_label ? h("span", { class: "big-unit" }, def.unit_label) : null),
    h("div", { class: "m-status" }, chip(ms.status), h("span", { class: "muted" }, formatDateRu(ms.latest.date))),
    rangeBar(ms));
  const goal = goalText(def);
  if (goal) head.append(h("p", { class: "goal-line" }, goal));
  if (def.basis) head.append(h("p", { class: "basis" }, def.basis));
  out.push(head);

  if (comment) out.push(comment);
  if (def.why) out.push(heading("Что это"), h("div", { class: "card pad" }, h("p", null, def.why)));

  const rows = ms.series.slice().reverse().map((p) => h("tr", null,
    h("td", null, formatDateRu(p.date)),
    h("td", { class: "num" }, valueText(p, def)),
    h("td", { class: "num" }, refText(p.ref, dec)),
    h("td", null, p.derived ? "расчёт" : p.verified ? "проверено" : "не проверено")));
  out.push(heading("Динамика"),
    h("div", { class: "card pad" },
      historyChart(ms),
      h("div", { class: "table-wrap" },
        h("table", null,
          h("thead", null, h("tr", null,
            h("th", null, "Дата"), h("th", null, "Значение"), h("th", null, "Референс"), h("th", null, "Данные"))),
          h("tbody", null, ...rows)))));

  const related = (ms.related || []).map((rid) => model.markers[rid]).filter(Boolean);
  if (related.length) {
    out.push(heading("Связанные показатели"),
      h("div", { class: "card" }, ...related.map((r) =>
        h("a", { class: "row", href: markerHref(r.def.id) },
          h("div", { class: "row-main" },
            h("span", { class: "row-name" }, r.def.name),
            h("span", { class: "m-value" + (r.latest ? "" : " none") },
              r.latest ? valueText(r.latest, r.def) : "нет данных"))))));
  }

  out.push(heading("Пересдача"), h("div", { class: "card pad" }, h("p", null, recheckText(ms))));
  return screen(def.name, back, ...out);
}

// ---- plan ----------------------------------------------------------------------

function stat(value, label, tone) {
  return h("div", { class: "stat" + (tone ? " stat-" + tone : "") },
    h("span", { class: "stat-value" }, String(value)), h("span", { class: "stat-label" }, label));
}

// The next eight days as a strip; a day with items is a filter.
function dayStrip(model) {
  const cells = [];
  for (let i = 0; i < 8; i += 1) {
    const date = addDays(model.today, i);
    const items = model.plan.filter((p) => p.date === date);
    const [y, m, d] = parts(date);
    const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    cells.push(h("button", {
      type: "button", class: "day" + (i === 0 ? " is-today" : ""), disabled: items.length ? null : true,
      "aria-pressed": String(ui.planDate === date),
      "aria-label": `${formatDateRu(date)}: ${items.length} ${plural(items.length, "пункт", "пункта", "пунктов")}`,
      onclick: () => { ui.planDate = ui.planDate === date ? null : date; rerender(); },
    },
      h("span", { class: "day-week" }, weekday),
      h("span", { class: "day-num" }, String(d)),
      h("span", { class: "day-dots" }, ...items.slice(0, 4).map((p) => h("span", { class: "dot prio-" + p.priority })))));
  }
  return h("div", { class: "days", role: "group", "aria-label": "Ближайшие восемь дней" }, ...cells);
}

export function planView(model) {
  if (!model) return todayView(null);
  const sent = readSent(model);
  const plan = model.plan;
  const count = (test) => plan.filter(test).length;
  const out = [];

  out.push(h("div", { class: "stats" },
    stat(count((i) => i.urgency === "overdue"), "просрочено", count((i) => i.urgency === "overdue") ? "alert" : null),
    stat(count((i) => i.urgency === "week"), "на этой неделе"),
    stat(count((i) => i.priority === "high" && (i.urgency === "week" || i.urgency === "overdue")), "из них важных")));
  out.push(dayStrip(model));
  out.push(filterBar("Фильтр по приоритету", [
    ["all", "Все", plan.length],
    ["high", "Высокий", count((i) => i.priority === "high")],
    ["medium", "Средний", count((i) => i.priority === "medium")],
    ["low", "Низкий", count((i) => i.priority === "low")],
  ], ui.planPriority, (value) => { ui.planPriority = value; }));

  const shown = plan.filter((i) => (ui.planPriority === "all" || i.priority === ui.planPriority)
    && (!ui.planDate || i.date === ui.planDate));
  if (ui.planDate) {
    out.push(h("p", { class: "filter-note" }, `Показан день: ${formatDateRu(ui.planDate)}. `,
      h("button", { class: "btn-text", type: "button", onclick: () => { ui.planDate = null; rerender(); } }, "Показать все дни")));
  }
  for (const [urgency, title] of URGENCY_SECTIONS) {
    const items = shown.filter((i) => i.urgency === urgency);
    if (!items.length) continue;
    out.push(h("h2", { class: "section-" + urgency }, title, h("span", { class: "count" }, String(items.length))),
      h("div", { class: "stack" }, ...items.map((i) => planItem(model, i, sent))));
  }
  if (!shown.length) out.push(h("p", { class: "muted" }, plan.length ? "Под выбранный фильтр ничего не попало." : "План пуст."));
  return screen("План", null, ...out);
}

// ---- summary (guest only) -------------------------------------------------------

export function summaryView(model) {
  const text = model && model.summary;
  return screen("Сводка", null,
    h("div", { class: "card pad summary" },
      text ? renderMarkdown(text) : h("p", { class: "muted" }, "Сводка не приложена.")));
}

// ---- curator -------------------------------------------------------------------

export function curatorView(model) {
  if (!model) return todayView(null);
  const curator = model.curator;
  const due = model.plan.filter((i) => (i.urgency === "overdue" || i.urgency === "week") && i.handoff);
  const sent = readSent(model);
  const out = [];

  out.push(h("section", { class: "lead" },
    h("h2", { class: "lead-headline" }, "Данные вносит куратор"),
    h("p", { class: "lead-text" }, "Приложение только показывает. Чтобы цифры появились здесь, отправь их куратору: он проверит их, внесёт в репозиторий, обновит комментарии и план."),
    curator && curator.where ? h("p", { class: "lead-where" }, h("strong", null, "Куда отправлять: "), curator.where) : null,
    h("ol", { class: "steps" },
      h("li", null, "Сделай измерение или получи результат."),
      h("li", null, "Скопируй шаблон, впиши цифры и дату, отправь в чат."),
      h("li", null, "Куратор ответит, что записано. Обнови приложение."))));

  out.push(h("h2", null, "Ждёт от тебя", h("span", { class: "count" }, String(due.length))));
  out.push(due.length
    ? h("div", { class: "stack" }, ...due.map((i) => planItem(model, i, sent)))
    : h("p", { class: "muted" }, "На этой неделе куратор ничего не ждёт."));

  if (model.routine && model.routine.length) {
    out.push(heading("По расписанию"));
    out.push(h("div", { class: "stack" }, ...model.routine.map((r) => h("div", { class: "card pad routine" },
      h("div", { class: "routine-when" }, r.when),
      h("div", { class: "plan-title" }, r.title),
      h("p", { class: "routine-what" }, r.what),
      r.handoff ? handoffBlock(r.handoff) : null))));
  }

  out.push(heading("Правила передачи"));
  out.push(h("div", { class: "card pad" }, h("ul", { class: "rules" },
    h("li", null, "У каждой цифры должна быть дата измерения."),
    h("li", null, "Анализы: PDF из лаборатории целиком. Пересказ цифр даёт ошибки."),
    h("li", null, "Бумажный бланк: фото листа целиком, чтобы были видны дата, единицы и референсы."),
    h("li", null, "Опросники проходятся прямо в чате: куратор задаёт вопросы и считает баллы."),
    h("li", null, "Если в цифре не уверен, так и напиши. Куратор её не угадывает."))));
  return screen("Куратор", null, ...out);
}

// ---- settings ------------------------------------------------------------------

const syncFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" });

export function settingsView(o) {
  const { source, repo, hasToken, fetchedAt, error, busy, draft, onSave, onRefresh, onClear } = o;
  const out = [];
  if (error) {
    out.push(h("p", { class: "message", role: "alert" }, statusIcon("out"),
      h("span", null, error.message || String(error))));
  }

  if (source && source.mode === "local") {
    out.push(h("p", { class: "muted" }, `Локальный режим: данные читаются из ${source.base}.`));
    return screen("Настройки", null, ...out);
  }

  const repoInput = h("input", {
    id: "f-repo", name: "repo", type: "text", placeholder: "владелец/репозиторий",
    autocapitalize: "off", autocorrect: "off", spellcheck: "false", autocomplete: "off",
    value: draft && draft.repo != null ? draft.repo : repo || "",
  });
  const tokenInput = h("input", {
    id: "f-token", name: "token", type: "password", autocomplete: "off",
    autocapitalize: "off", autocorrect: "off", spellcheck: "false",
    placeholder: hasToken ? "Сохранён на этом устройстве" : "",
    value: draft && draft.token ? draft.token : null,
  });
  const form = h("form", {
    class: "card pad form", novalidate: true,
    onsubmit: (e) => { e.preventDefault(); onSave(repoInput.value.trim(), tokenInput.value.trim()); },
  },
    h("label", { for: "f-repo" }, "Репозиторий с данными"), repoInput,
    h("label", { for: "f-token" }, "Токен доступа"), tokenInput,
    h("p", { class: "muted help" }, "Нужен fine-grained токен GitHub с доступом только к репозиторию данных и правом Contents: Read-only. Токен хранится на этом устройстве и отправляется только на api.github.com."),
    h("button", { class: "btn btn-primary", type: "submit", disabled: busy ? true : null }, "Сохранить и загрузить"));
  out.push(form);

  if (source) {
    out.push(h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", disabled: busy ? true : null, onclick: onRefresh }, "Обновить данные")));
  }
  if (busy) out.push(h("p", { class: "muted", role: "status" }, "Загрузка…"));
  if (fetchedAt) {
    const d = new Date(fetchedAt);
    if (!isNaN(d)) out.push(h("p", { class: "muted" }, "Обновлено: " + syncFmt.format(d)));
  }
  out.push(h("div", { class: "actions" },
    h("button", {
      class: "btn-text btn-danger", type: "button",
      onclick: () => { if (confirm("Удалить токен и сохранённые данные с этого устройства?")) onClear(); },
    }, "Удалить данные с этого устройства")));
  return screen("Настройки", null, ...out);
}
