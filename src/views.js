// One function per screen. Each returns a DOM node (div.screen) carrying
// data-title and, optionally, data-back-href / data-back-label for the router.
import { formatValue } from "./engine.js";
import { h, formatDateRu, valueText, refText } from "./dom.js";
import { calibrationStrip, rangeBar, historyChart, statusIcon } from "./charts.js";

const STATUS_WORD = {
  optimal: "В норме", watch: "Внимание", out: "Вне нормы", nodata: "Нет данных", unrated: "Без нормы",
};
const STATE_WORD = { overdue: "Просрочено", soon: "Скоро", missing: "Не измерено", ok: "По графику" };

function screen(title, back, ...children) {
  return h("div", {
    class: "screen", "data-title": title,
    "data-back-href": back ? back.href : null, "data-back-label": back ? back.label : null,
  }, ...children);
}

function statusLine(status) {
  return h("span", { class: "status st-" + status }, statusIcon(status), h("span", null, STATUS_WORD[status] || status));
}

const heading = (text) => h("h2", null, text);

// ---- Today -------------------------------------------------------------------

function primaryOf(model, d) {
  return d.markerIds.map((id) => model.markers[id]).filter((m) => m && m.def.role === "primary");
}

function domainRow(model, d) {
  const prim = primaryOf(model, d);
  const measured = prim.filter((m) => m.latest);
  const missing = prim.length - measured.length;
  const noData = d.status === "nodata" || measured.length === 0;
  const meta = h("div", { class: "row-meta muted" });
  if (!noData) meta.append(h("span", null, `${d.counts.optimal} из ${measured.length} в норме`));
  if (missing > 0) meta.append(h("span", null, `не измерено: ${missing}`));
  return h("a", { class: "row domain-row", href: `#/domain/${encodeURIComponent(d.id)}` },
    h("div", { class: "row-main" },
      h("span", { class: "row-name serif" }, d.name),
      statusLine(noData ? "nodata" : d.status)),
    noData ? null : calibrationStrip(prim),
    meta);
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
  const first = item.markerIds[0];
  const right = h("div", { class: "row-side" });
  if (opts.showState) right.append(h("span", { class: "state state-" + item.state }, STATE_WORD[item.state]));
  if (item.date) right.append(h("span", { class: "muted" }, formatDateRu(item.date)));
  const row = h("a", { class: "row plan-row", href: `#/marker/${encodeURIComponent(first)}` },
    h("div", { class: "row-main" }, h("span", { class: "row-name" }, planTitle(model, item)), right));
  if (item.markerIds.length > 1) {
    const names = item.markerIds.map((id) => model.markers[id] && model.markers[id].def.name).filter(Boolean);
    row.append(h("div", { class: "muted row-detail" }, names.join(", ")));
  } else if (item.state === "missing" && model.markers[first] && model.markers[first].def.why) {
    row.append(h("div", { class: "muted row-detail" }, model.markers[first].def.why));
  }
  return row;
}

export function todayView(model) {
  if (!model) {
    return screen("Сегодня", null,
      h("div", { class: "block pad" },
        h("p", null, "Данные не подключены. Укажите репозиторий с данными и токен доступа."),
        h("a", { class: "btn btn-primary", href: "#/settings" }, "Подключить данные")));
  }
  const next = model.plan.filter((i) => i.state === "overdue" || i.state === "soon" || i.state === "missing").slice(0, 4);
  return screen("Сегодня", null,
    h("p", { class: "mission serif" }, model.mission),
    h("p", { class: "muted data-date" },
      model.lastObservationDate ? "Данные на " + formatDateRu(model.lastObservationDate) : "Измерений пока нет."),
    h("div", { class: "block" }, ...model.domains.map((d) => domainRow(model, d))),
    heading("Что дальше"),
    next.length
      ? h("div", { class: "block" }, ...next.map((i) => planRow(model, i, { showState: true })))
      : h("p", { class: "muted" }, "Ближайших измерений нет."),
    h("p", { class: "more" }, h("a", { href: "#/plan" }, "Весь план")));
}

// ---- Domain ------------------------------------------------------------------

function markerRow(ms) {
  const def = ms.def;
  return h("a", { class: "row marker-row", href: `#/marker/${encodeURIComponent(def.id)}` },
    h("div", { class: "row-main" },
      h("span", { class: "row-name" }, def.name, ms.latest && ms.latest.derived ? h("span", { class: "muted suffix" }, "расчёт") : null),
      h("span", { class: "value" }, valueText(ms.latest, def))),
    rangeBar(ms),
    h("div", { class: "row-meta" }, statusLine(ms.status), h("span", { class: "muted" }, formatDateRu(ms.latest.date))));
}

export function domainView(model, id) {
  const d = model && model.domains.find((x) => x.id === id);
  if (!d) {
    return screen("Раздел", { href: "#/", label: "Назад" },
      h("p", null, "Раздел не найден."), h("p", null, h("a", { href: "#/" }, "К сводке")));
  }
  const all = d.markerIds.map((mid) => model.markers[mid]).filter(Boolean);
  const prim = all.filter((m) => m.def.role === "primary" && m.latest);
  const sec = all.filter((m) => m.def.role !== "primary" && m.latest);
  const none = all.filter((m) => !m.latest);
  const out = [];
  if (d.goal) out.push(h("p", { class: "goal" }, d.goal));
  if (prim.length) out.push(h("div", { class: "block" }, ...prim.map(markerRow)));
  if (sec.length) {
    out.push(h("details", { class: "block more-details" },
      h("summary", null, "Дополнительные показатели"),
      ...sec.map(markerRow)));
  }
  if (none.length) {
    out.push(heading("Не измерено"));
    out.push(h("div", { class: "block" }, ...none.map((m) =>
      h("a", { class: "row", href: `#/marker/${encodeURIComponent(m.def.id)}` },
        h("div", { class: "row-name" }, m.def.name),
        m.def.why ? h("div", { class: "muted row-detail" }, m.def.why) : null))));
  }
  return screen(d.name, { href: "#/", label: "Назад" }, ...out);
}

// ---- Marker ------------------------------------------------------------------

function boundsWords(opt, dec) {
  const lo = opt.low != null ? formatValue(opt.low, dec) : null;
  const hi = opt.high != null ? formatValue(opt.high, dec) : null;
  if (lo != null && hi != null) return `от ${lo} до ${hi}`;
  if (hi != null) return `не выше ${hi}`;
  if (lo != null) return `не ниже ${lo}`;
  return "";
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

  if (!ms.latest) {
    out.push(h("div", { class: "block pad" },
      h("p", null, def.why),
      def.basis ? h("p", { class: "muted" }, def.basis) : null,
      h("p", null, "Ещё не измерялось.")));
    return screen(def.name, back, ...out);
  }

  // head block
  const head = h("div", { class: "block pad" },
    h("div", { class: "big" },
      h("span", { class: "big-value" }, formatValue(ms.latest.value, dec, ms.latest.comparator)),
      def.unit_label ? h("span", { class: "big-unit" }, def.unit_label) : null),
    h("div", { class: "row-meta" }, statusLine(ms.status), h("span", { class: "muted" }, formatDateRu(ms.latest.date))),
    h("div", { class: "head-bar" }, rangeBar(ms)));
  const opt = def.optimal;
  if (opt && (opt.low != null || opt.high != null)) {
    head.append(h("p", { class: "goal-line" }, "Цель: " + boundsWords(opt, dec),
      def.basis ? h("span", { class: "muted basis" }, def.basis) : null));
  } else if (def.basis) {
    head.append(h("p", { class: "muted goal-line" }, def.basis));
  }
  out.push(head);

  if (def.why) out.push(heading("Зачем"), h("div", { class: "block pad" }, h("p", null, def.why)));

  // history
  const rows = ms.series.slice().reverse().map((p) => h("tr", null,
    h("td", null, formatDateRu(p.date)),
    h("td", { class: "num" }, valueText(p, def)),
    h("td", { class: "num" }, refText(p.ref, dec)),
    h("td", null, p.derived ? "расчёт" : p.verified ? "проверено" : "не проверено")));
  out.push(heading("Динамика"),
    h("div", { class: "block pad" },
      historyChart(ms),
      h("div", { class: "table-wrap" },
        h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Дата"), h("th", null, "Значение"), h("th", null, "Референс"), h("th", null, "Данные"))),
          h("tbody", null, ...rows)))));

  // related
  const rel = (ms.related || []).map((rid) => model.markers[rid]).filter(Boolean);
  if (rel.length) {
    out.push(heading("Связанные показатели"),
      h("div", { class: "block" }, ...rel.map((r) =>
        h("a", { class: "row", href: `#/marker/${encodeURIComponent(r.def.id)}` },
          h("div", { class: "row-main" },
            h("span", { class: "row-name" }, r.def.name),
            h("span", { class: "value" }, r.latest ? valueText(r.latest, r.def) : h("span", { class: "muted" }, "нет данных")))))));
  }

  out.push(heading("Пересдача"), h("div", { class: "block pad" }, h("p", null, recheckText(ms))));
  return screen(def.name, back, ...out);
}

// ---- Plan --------------------------------------------------------------------

export function planView(model) {
  if (!model) return todayView(null);
  const sections = [["overdue", "Просрочено"], ["soon", "Скоро"], ["missing", "Не измерено"], ["ok", "По графику"]];
  const out = [];
  for (const [state, title] of sections) {
    const items = model.plan.filter((i) => i.state === state);
    if (!items.length) continue;
    out.push(heading(title), h("div", { class: "block" }, ...items.map((i) => planRow(model, i))));
  }
  if (!out.length) out.push(h("p", { class: "muted" }, "План пуст."));
  return screen("План", null, ...out);
}

// ---- Settings ----------------------------------------------------------------

const syncFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" });

export function settingsView(o) {
  const { source, repo, hasToken, fetchedAt, error, busy, draft, onSave, onRefresh, onClear } = o;
  const out = [];
  if (error) out.push(h("p", { class: "message", role: "alert" }, statusIcon("out"), h("span", null, error.message || String(error))));

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
    class: "block pad form", novalidate: true,
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
