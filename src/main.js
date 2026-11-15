import { getSource, getSettings, saveSettings, clearDevice, readCache, loadBundle } from "./data.js";
import { buildModel } from "./engine.js";
import { h } from "./dom.js";
import { statusIcon } from "./charts.js";
import { todayView, markerView, planView, settingsView, openDomain } from "./views.js";

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $back = document.getElementById("back");
const $tabs = [...document.querySelectorAll("[data-tab]")];

const state = { source: null, model: null, fetchedAt: null, loading: false, error: null };
let bootId = 0;

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function applyBundle(bundle) {
  state.model = buildModel({
    profile: bundle.profile, goals: bundle.goals, catalog: bundle.catalog,
    observations: bundle.observations, plan: bundle.plan || null, today: todayStr(),
  });
  // Interpretation travels next to the model; statuses never depend on it.
  state.model.commentary = bundle.commentary || null;
  state.fetchedAt = bundle.fetchedAt || null;
}

// ---- routing -----------------------------------------------------------------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const arg = parts[1] ? decodeURIComponent(parts[1]) : "";
  if (parts[0] === "domain" && arg) return { name: "domain", id: arg };
  if (parts[0] === "marker" && arg) return { name: "marker", id: arg };
  if (parts[0] === "plan") return { name: "plan" };
  if (parts[0] === "settings") return { name: "settings" };
  return { name: "today" };
}

function placeholder() {
  const msg = state.loading ? "Загружаю данные…" : state.error ? state.error.message : "Данные не загружены.";
  return h("div", { class: "screen", "data-title": "Сегодня" }, h("div", { class: "card pad" }, h("p", { role: "status" }, msg),
    state.error && state.error.code === "auth" ? h("a", { href: "#/settings" }, "Открыть настройки") : null));
}

function settingsNode() {
  const saved = getSettings();
  const repoEl = document.getElementById("f-repo"), tokEl = document.getElementById("f-token");
  const draft = repoEl && tokEl ? { repo: repoEl.value, token: tokEl.value } : null;
  return settingsView({
    source: state.source, repo: saved ? saved.repo : "", hasToken: !!(saved && saved.token),
    fetchedAt: state.fetchedAt, error: state.error, busy: state.loading, draft,
    onSave, onRefresh: () => boot(), onClear: () => { clearDevice(); boot(); },
  });
}

function viewFor(route) {
  if (route.name === "settings") return settingsNode();
  if (state.source && !state.model) {
    const p = placeholder();
    if (route.name === "plan") p.dataset.title = "План";
    return p;
  }
  switch (route.name) {
    // A system has no page of its own: it is a section of the today screen.
    case "domain": openDomain(route.id); return todayView(state.model);
    case "marker": return markerView(state.model, route.id);
    case "plan": return planView(state.model);
    default: return todayView(state.model);
  }
}

function render(fresh) {
  const route = parseRoute();
  const node = viewFor(route);
  const children = [];
  // a failed background refresh keeps the shown data and adds one line on top
  if (state.error && state.model && route.name !== "settings") {
    children.push(h("p", { class: "notice", role: "status" }, statusIcon("out"),
      h("span", null, state.error.message, state.error.code === "auth" ? [" ", h("a", { href: "#/settings" }, "Настройки")] : null)));
  }
  children.push(node);
  $view.replaceChildren(...children);

  $title.textContent = node.dataset.title || "Долголетие";
  document.title = $title.textContent === "Сегодня" ? "Долголетие" : $title.textContent + " — Долголетие";
  if (node.dataset.backHref) {
    $back.hidden = false;
    $back.setAttribute("href", node.dataset.backHref);
    $back.textContent = node.dataset.backLabel || "Назад";
  } else {
    $back.hidden = true;
  }
  const active = route.name === "plan" ? "plan" : route.name === "settings" ? "settings" : "today";
  for (const a of $tabs) {
    if (a.dataset.tab === active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (fresh) {
    const target = route.name === "domain" ? document.getElementById("domain-" + route.id) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
    $title.focus({ preventScroll: true });
  }
}

// ---- data --------------------------------------------------------------------

async function boot() {
  const id = ++bootId;
  state.source = getSource();
  state.error = null;
  state.model = null;
  state.fetchedAt = null;
  state.loading = false;
  if (!state.source) { render(false); return; }

  if (state.source.mode === "github") {
    const cached = readCache();
    if (cached) {
      try { applyBundle(cached); } catch (e) { state.model = null; }
    }
  }
  state.loading = true;
  render(false);
  try {
    const bundle = await loadBundle(state.source);
    if (id !== bootId) return;
    applyBundle(bundle);
  } catch (e) {
    if (id !== bootId) return;
    state.error = e;
  }
  state.loading = false;
  render(false);
}

function validRepo(s) { return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s); }

function onSave(repo, token) {
  const saved = getSettings();
  const tok = token || (saved && saved.token) || "";
  if (!validRepo(repo)) {
    state.error = new Error("Укажите репозиторий в формате владелец/репозиторий.");
    render(false);
    return;
  }
  if (!tok) {
    state.error = new Error("Укажите токен доступа.");
    render(false);
    return;
  }
  saveSettings({ repo, token: tok });
  // A successful load leaves the settings screen: staying on the form with no
  // visible change reads as "nothing happened". Errors keep the form in view.
  boot().then(() => {
    if (!state.error && state.model) location.hash = "#/";
  });
}

window.addEventListener("hashchange", () => render(true));

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    try { navigator.serviceWorker.register("sw.js").catch(() => {}); } catch (e) { /* ignored */ }
  });
}

boot();
render(true);
