// One function per screen. Each returns a DOM node (div.screen) carrying
// data-title and, optionally, data-back-href / data-back-label for the router.
//
// The today screen is a three-level disclosure: body systems, then the markers
// of a system, then one marker with its range, the model's comment and a link
// to the full history. Nothing below the first level is in the DOM until it is
// opened.
import { formatValue } from "./engine.js";
import { h, formatDateRu, valueText, refText } from "./dom.js";
import { rangeBar, historyChart, statusIcon } from "./charts.js";

const STATUS_WORD = {
  optimal: "В норме", watch: "Внимание", out: "Вне нормы", nodata: "Нет данных", unrated: "Без нормы",
};
const MARKER_TALLY = {
  out: "вне нормы", watch: "внимание", optimal: "в норме", unrated: "без нормы", nodata: "не измерено",
};
const DOMAIN_TALLY = {
  out: "вне нормы", watch: "внимание", optimal: "в норме", unrated: "без нормы", nodata: "без данных",
};
const TALLY_ORDER = ["out", "watch", "optimal", "unrated", "nodata"];
// Problems first, then what has never been assessed, then what is fine.
const DOMAIN_ORDER = { out: 0, watch: 1, nodata: 2, unrated: 3, optimal: 4 };
const STATE_WORD = { overdue: "Просрочено", soon: "Скоро", missing: "Не измерено", ok: "По графику" };

function screen(title, back, ...children) {
  return h("div", {
    class: "screen", "data-title": title,
    "data-back-href": back ? back.href : null, "data-back-label": back ? back.label : null,
  }, ...children);
}

const heading = (text) => h("h2", null, text);
const markerHref = (id) => `#/marker/${encodeURIComponent(id)}`;

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
  if (due.state === "missing") return "Ещё не измерялось.";
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
    statusIcon(ms.latest ? ms.status : "nodata"),
    h("span", { class: "m-name" }, def.name,
      ms.latest && ms.latest.derived ? h("span", { class: "suffix" }, "расчёт") : null),
    ms.latest
      ? h("span", { class: "m-value" }, valueText(ms.latest, def))
      : h("span", { class: "m-value none" }, "нет данных"),
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
    tally(d.counts, MARKER_TALLY),
  ], () => domainBody(model, d));
}

// ---- today ---------------------------------------------------------------------

function fallbackHeadline(counts) {
  if (counts.out) return `Вне нормы систем: ${counts.out}`;
  if (counts.watch) return `Требуют внимания систем: ${counts.watch}`;
  return "Отклонений в измеренных системах нет";
}

function lead(model) {
  const c = model.commentary;
  const counts = {};
  for (const d of model.domains) counts[d.status] = (counts[d.status] || 0) + 1;
  const summary = c && c.summary;
  const stale = !!(c && c.as_of && model.lastObservationDate && model.lastObservationDate > c.as_of);
  return h("section", { class: "lead" },
    h("p", { class: "lead-date" },
      model.lastObservationDate ? "Данные на " + formatDateRu(model.lastObservationDate) : "Измерений пока нет"),
    h("h2", { class: "lead-headline" }, summary && summary.headline ? summary.headline : fallbackHeadline(counts)),
    summary && summary.text ? h("p", { class: "lead-text" }, summary.text) : null,
    tally(counts, DOMAIN_TALLY),
    c && c.author ? h("p", { class: "lead-by" },
      `Разбор: ${c.author}` + (c.written ? `, ${formatDateRu(c.written)}` : "") +
      (stale ? ". С тех пор появились новые измерения." : "")) : null);
}

// A group of one marker is named after the marker: a panel title would hide
// which test is actually due ("hormone panel" instead of "estradiol").
function planTitle(model, item) {
  if (item.markerIds.length === 1) {
    const only = model.markers[item.markerIds[0]];
    if (only) return only.def.name;
  }
  return item.title;
}

function planRow(model, item, opts = {}) {
  const first = model.markers[item.markerIds[0]];
  const side = h("div", { class: "row-side" });
  if (opts.showState) side.append(h("span", { class: "state state-" + item.state }, STATE_WORD[item.state]));
  if (item.date) side.append(h("span", { class: "muted" }, formatDateRu(item.date)));
  const row = h("a", { class: "row", href: markerHref(item.markerIds[0]) },
    h("div", { class: "row-main" }, h("span", { class: "row-name" }, planTitle(model, item)), side));
  if (item.markerIds.length > 1) {
    const names = item.markerIds.map((id) => model.markers[id] && model.markers[id].def.name).filter(Boolean);
    row.append(h("div", { class: "row-detail" }, names.join(", ")));
  } else if (item.state === "missing" && first && first.def.why) {
    row.append(h("div", { class: "row-detail" }, first.def.why));
  }
  return row;
}

export function todayView(model) {
  if (!model) {
    return screen("Сегодня", null,
      h("div", { class: "card pad" },
        h("p", null, "Данные не подключены. Укажите репозиторий с данными и токен доступа."),
        h("a", { class: "btn btn-primary", href: "#/settings" }, "Подключить данные")));
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
  const next = model.plan
    .filter((i) => i.state === "overdue" || i.state === "soon" || i.state === "missing").slice(0, 4);
  return screen("Сегодня", null,
    model.mission ? h("p", { class: "mission" }, model.mission) : null,
    lead(model),
    ...sections.flatMap((sec) => [
      heading(sec.title),
      h("div", { class: "stack" }, ...bySeverity(sec.domains).map((d) => domainItem(model, d))),
    ]),
    heading("Что дальше"),
    next.length
      ? h("div", { class: "card" }, ...next.map((i) => planRow(model, i, { showState: true })))
      : h("p", { class: "muted" }, "Ближайших измерений нет."),
    h("p", { class: "more" }, h("a", { href: "#/plan" }, "Весь план")));
}

// ---- marker page (full detail) -------------------------------------------------

export function markerView(model, id) {
  const ms = model && model.markers[id];
  if (!ms) {
    return screen("Показатель", { href: "#/", label: "Назад" },
      h("p", null, "Показатель не найден."), h("p", null, h("a", { href: "#/" }, "К сводке")));
  }
  const def = ms.def;
  const dec = def.decimals ?? 0;
  const back = { href: `#/domain/${encodeURIComponent(def.domain)}`, label: "Назад" };
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

export function planView(model) {
  if (!model) return todayView(null);
  const sections = [["overdue", "Просрочено"], ["soon", "Скоро"], ["missing", "Не измерено"], ["ok", "По графику"]];
  const out = [];
  for (const [state, title] of sections) {
    const items = model.plan.filter((i) => i.state === state);
    if (!items.length) continue;
    out.push(h("h2", null, title, h("span", { class: "count" }, String(items.length))),
      h("div", { class: "card" }, ...items.map((i) => planRow(model, i))));
  }
  if (!out.length) out.push(h("p", { class: "muted" }, "План пуст."));
  return screen("План", null, ...out);
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
