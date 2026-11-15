// Data layer: settings, cache and loading of the private data repository.
// Contract: docs/ARCHITECTURE.md, section "Data layer contract".
// The token is stored only in localStorage and sent only to api.github.com.

import { parseJsonl } from "./engine.js";

const SETTINGS_KEY = "longevity.settings.v1";
const CACHE_KEY = "longevity.cache.v1";
const API_ROOT = "https://api.github.com/repos/";
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const YEAR_FILE_PATTERN = /^(\d{4})\.jsonl$/;
const PROBE_YEARS = 30;

const MESSAGES = {
  auth: "Токен недействителен, истёк или не имеет доступа к репозиторию.",
  not_found: "Репозиторий или файл не найден. Проверьте имя репозитория и права токена.",
  network: "Нет связи с GitHub. Показаны данные с устройства.",
};

/**
 * Error raised by the data layer.
 * `code` is one of "auth" | "not_found" | "network" | "format".
 */
export class DataError extends Error {
  /**
   * @param {"auth"|"not_found"|"network"|"format"} code
   * @param {string} [message] Russian message; a default is used for known codes.
   */
  constructor(code, message) {
    super(message || MESSAGES[code] || "Ошибка данных.");
    this.name = "DataError";
    this.code = code;
  }
}

function storageGet(key) {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing to remove
  }
}

/**
 * Reads saved repository name and token from localStorage.
 * @returns {{repo: string, token: string} | null}
 */
export function getSettings() {
  const raw = storageGet(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value.repo === "string" && typeof value.token === "string" && value.repo && value.token) {
      return { repo: value.repo, token: value.token };
    }
  } catch {
    // corrupted entry: treat as absent
  }
  return null;
}

/**
 * Validates and stores repository name and token. Both fields are trimmed.
 * @param {{repo: string, token: string}} settings
 * @throws {DataError} code "format" when the repository name or token is invalid
 */
export function saveSettings({ repo, token }) {
  const cleanRepo = String(repo ?? "").trim();
  const cleanToken = String(token ?? "").trim();
  if (!REPO_PATTERN.test(cleanRepo)) {
    throw new DataError("format", "Имя репозитория должно быть в виде «владелец/репозиторий».");
  }
  if (!cleanToken) {
    throw new DataError("format", "Укажите токен доступа.");
  }
  const ok = storageSet(SETTINGS_KEY, JSON.stringify({ repo: cleanRepo, token: cleanToken }));
  if (!ok) {
    throw new DataError("format", "Не удалось сохранить настройки на устройстве.");
  }
}

/** Removes settings and cache from this device. */
export function clearDevice() {
  storageRemove(SETTINGS_KEY);
  storageRemove(CACHE_KEY);
}

function validBase(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw.includes("\\")) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  const base = raw.replace(/\/+$/, "");
  if (base === "" || base.startsWith("//")) return null;
  return base;
}

/**
 * Chooses where data comes from: `?base=` (local mode), saved settings (github mode) or nothing.
 * @returns {{mode: "local", base: string} | {mode: "github", repo: string, token: string} | null}
 */
export function getSource() {
  let raw = null;
  try {
    raw = new URLSearchParams(globalThis.location?.search || "").get("base");
  } catch {
    raw = null;
  }
  const base = validBase(raw);
  if (base) return { mode: "local", base };
  const settings = getSettings();
  if (settings) return { mode: "github", repo: settings.repo, token: settings.token };
  return null;
}

/**
 * Reads the last bundle stored by a github-mode load. A cache written before
 * `commentary` or `plan` was added is returned with `commentary: null` / `plan: null`.
 * @returns {object | null} Bundle or null
 */
export function readCache() {
  const raw = storageGet(CACHE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value && value.profile && value.goals && value.catalog && Array.isArray(value.observations)) {
      // caches written before these files existed have no such keys
      const filled = { ...value };
      if (!("commentary" in filled)) filled.commentary = null;
      if (!("plan" in filled)) filled.plan = null;
      return filled;
    }
  } catch {
    // corrupted cache: ignore
  }
  return null;
}

function writeCache(bundle) {
  storageSet(CACHE_KEY, JSON.stringify(bundle));
}

async function request(url, init, label) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new DataError("network");
  }
  if (response.status === 401 || response.status === 403) throw new DataError("auth");
  if (response.status === 404) {
    const error = new DataError("not_found");
    error.missing = true;
    error.label = label;
    throw error;
  }
  if (!response.ok) {
    throw new DataError("network", `Ошибка ответа GitHub (HTTP ${response.status}) при чтении ${label}.`);
  }
  try {
    return await response.text();
  } catch {
    throw new DataError("network");
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError("format", `Файл ${label} не является корректным JSON.`);
  }
}

// commentary.json and plan.json are optional: 404 means "absent"; auth and network failures propagate.
function optional(promise) {
  return promise.catch((error) => {
    if (error instanceof DataError && error.missing) return null;
    throw error;
  });
}

// Commentary and plan are layers on top of the numbers. A broken file must
// not take the numbers down with it, so anything that is not a JSON object counts as "none".
function parseOptionalObject(text) {
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseObservations(text, label) {
  try {
    return parseJsonl(text);
  } catch (error) {
    throw new DataError("format", `Файл ${label}: ${error.message}`);
  }
}

async function loadGithub(source) {
  const { repo, token } = source;
  const base = `${API_ROOT}${repo}/contents/`;
  // Only Authorization and Accept are sent: every extra request header has to be
  // allowed by the API's CORS preflight, and these two are known to be.
  const common = { Authorization: `Bearer ${token}` };
  const rawInit = { headers: { ...common, Accept: "application/vnd.github.raw+json" }, cache: "no-store" };
  const listInit = { headers: { ...common, Accept: "application/vnd.github+json" }, cache: "no-store" };

  const getFile = (path) => request(base + path, rawInit, path);
  const listing = request(`${base}observations`, listInit, "observations").catch((error) => {
    if (error instanceof DataError && error.missing) return null;
    throw error;
  });

  const [profileText, goalsText, markersText, listingText, commentaryText, planText] = await Promise.all([
    getFile("profile.json"),
    getFile("catalog/goals.json"),
    getFile("catalog/markers.json"),
    listing,
    optional(getFile("commentary.json")),
    optional(getFile("plan.json")),
  ]);

  const profile = parseJson(profileText, "profile.json");
  const goals = parseJson(goalsText, "catalog/goals.json");
  const catalog = parseJson(markersText, "catalog/markers.json");
  const commentary = parseOptionalObject(commentaryText);
  const plan = parseOptionalObject(planText);

  let names = [];
  if (listingText !== null) {
    const entries = parseJson(listingText, "observations");
    if (!Array.isArray(entries)) {
      throw new DataError("format", "Каталог observations имеет неожиданный формат.");
    }
    names = entries
      .filter((entry) => entry && typeof entry.name === "string" && YEAR_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  const texts = await Promise.all(names.map((name) => getFile(`observations/${name}`)));
  const observations = [];
  texts.forEach((text, index) => {
    observations.push(...parseObservations(text, `observations/${names[index]}`));
  });

  const bundle = { profile, goals, catalog, observations, commentary, plan, fetchedAt: new Date().toISOString() };
  writeCache(bundle);
  return bundle;
}

async function loadLocal(source) {
  const base = source.base;
  const init = { method: "GET" };
  const getFile = (path) => request(`${base}/${path}`, init, path);

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let year = thisYear; year > thisYear - PROBE_YEARS; year -= 1) years.push(year);

  const probes = years.map((year) =>
    getFile(`observations/${year}.jsonl`).then(
      (text) => ({ year, text }),
      (error) => {
        if (error instanceof DataError && error.missing) return null;
        throw error;
      },
    ),
  );

  const [profileText, goalsText, markersText, commentaryText, planText, found] = await Promise.all([
    getFile("profile.json"),
    getFile("catalog/goals.json"),
    getFile("catalog/markers.json"),
    optional(getFile("commentary.json")),
    optional(getFile("plan.json")),
    Promise.all(probes),
  ]);

  const profile = parseJson(profileText, "profile.json");
  const goals = parseJson(goalsText, "catalog/goals.json");
  const catalog = parseJson(markersText, "catalog/markers.json");
  const commentary = parseOptionalObject(commentaryText);
  const plan = parseOptionalObject(planText);

  const observations = [];
  found
    .filter(Boolean)
    .sort((a, b) => a.year - b.year)
    .forEach(({ year, text }) => {
      observations.push(...parseObservations(text, `observations/${year}.jsonl`));
    });

  return { profile, goals, catalog, observations, commentary, plan, fetchedAt: new Date().toISOString() };
}

/**
 * Loads profile, catalog, all observations and the optional commentary.json and plan.json
 * (a 404 or a file that is not a JSON object gives `commentary: null` / `plan: null`;
 * auth and network failures are errors like for the other files). In github mode the
 * result is also written to the cache; local mode never touches settings or cache.
 * @param {{mode: "local", base: string} | {mode: "github", repo: string, token: string}} source
 * @returns {Promise<{profile: object, goals: object, catalog: object, observations: object[], commentary: object|null, plan: object|null, fetchedAt: string}>}
 * @throws {DataError}
 */
export async function loadBundle(source) {
  if (!source) throw new DataError("not_found", "Источник данных не настроен.");
  if (source.mode === "local") return loadLocal(source);
  return loadGithub(source);
}
