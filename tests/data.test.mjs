import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

globalThis.localStorage = makeStorage();
globalThis.location = { search: "" };

const data = await import("../src/data.js");
const { getSettings, saveSettings, clearDevice, getSource, readCache, loadBundle, DataError } = data;

const SETTINGS_KEY = "longevity.settings.v1";
const CACHE_KEY = "longevity.cache.v1";
const API = "https://api.github.com/repos/owner/repo/contents/";

let calls;

function reply(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function stubFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const handler = routes[String(url)];
    if (handler === undefined) return reply(404, "");
    if (handler instanceof Error) throw handler;
    return typeof handler === "function" ? handler() : handler;
  };
}

const profile = { version: 1, birth_date: "1990-01-01", sex: "x" };
const goals = { version: 1, mission: "m", domains: [{ id: "d1", name: "D", goal: "g" }] };
const catalog = { version: 1, panels: {}, markers: [] };
const obs = (date, value) => ({ date, marker: "m1", value, unit: "u", verified: true });

function githubRoutes(extra = {}) {
  return {
    [`${API}profile.json`]: reply(200, profile),
    [`${API}catalog/goals.json`]: reply(200, goals),
    [`${API}catalog/markers.json`]: reply(200, catalog),
    [`${API}commentary.json`]: reply(404, { message: "Not Found" }),
    [`${API}plan.json`]: reply(404, { message: "Not Found" }),
    [`${API}observations`]: reply(200, [
      { name: "2023.jsonl", type: "file" },
      { name: "2024.jsonl", type: "file" },
      { name: "README.md", type: "file" },
    ]),
    [`${API}observations/2023.jsonl`]: reply(200, JSON.stringify(obs("2023-05-01", 1)) + "\n"),
    [`${API}observations/2024.jsonl`]: reply(
      200,
      JSON.stringify(obs("2024-05-01", 2)) + "\n\n" + JSON.stringify(obs("2024-06-01", 3)) + "\n",
    ),
    ...extra,
  };
}

const githubSource = { mode: "github", repo: "owner/repo", token: "synthetic-token" };

beforeEach(() => {
  globalThis.localStorage = makeStorage();
  globalThis.location = { search: "" };
  calls = [];
});

test("settings round trip trims both fields", () => {
  assert.equal(getSettings(), null);
  saveSettings({ repo: "  owner/repo  ", token: "  tok  " });
  assert.deepEqual(getSettings(), { repo: "owner/repo", token: "tok" });
});

test("saveSettings rejects a malformed repository with code format", () => {
  for (const repo of ["", "owner", "owner/", "a/b/c", "owner/re po", "https://github.com/o/r"]) {
    assert.throws(
      () => saveSettings({ repo, token: "t" }),
      (error) => error instanceof DataError && error.code === "format",
      repo,
    );
  }
  assert.equal(getSettings(), null);
});

test("clearDevice removes settings, cache and interface state", () => {
  assert.equal(data.UI_STATE_KEY, "longevity.ui.v1");
  saveSettings({ repo: "owner/repo", token: "t" });
  localStorage.setItem(CACHE_KEY, "{}");
  localStorage.setItem("longevity.ui.v1", JSON.stringify({ sent: { m1: true } }));
  localStorage.setItem("unrelated.key", "keep");
  clearDevice();
  assert.equal(localStorage.getItem(SETTINGS_KEY), null);
  assert.equal(localStorage.getItem(CACHE_KEY), null);
  assert.equal(localStorage.getItem("longevity.ui.v1"), null);
  assert.equal(localStorage.getItem("unrelated.key"), "keep");
});

test("getSource accepts a valid base and strips the trailing slash", () => {
  globalThis.location = { search: "?base=/longevity-data/" };
  assert.deepEqual(getSource(), { mode: "local", base: "/longevity-data" });
});

test("getSource rejects protocol-relative and absolute bases", () => {
  for (const base of ["//evil.example", "https://evil.example", "/\\evil.example", "relative/path"]) {
    globalThis.location = { search: `?base=${encodeURIComponent(base)}` };
    assert.equal(getSource(), null, base);
  }
});

test("getSource falls back to settings, then null", () => {
  assert.equal(getSource(), null);
  saveSettings({ repo: "owner/repo", token: "t" });
  assert.deepEqual(getSource(), { mode: "github", repo: "owner/repo", token: "t" });
  globalThis.location = { search: "?base=//evil.example" };
  assert.equal(getSource().mode, "github");
});

test("github mode sends the right URLs and headers and concatenates observations", async () => {
  stubFetch(githubRoutes());
  const bundle = await loadBundle(githubSource);

  assert.deepEqual(bundle.profile, profile);
  assert.deepEqual(bundle.goals, goals);
  assert.deepEqual(bundle.catalog, catalog);
  assert.deepEqual(
    bundle.observations.map((o) => o.value),
    [1, 2, 3],
  );
  assert.match(bundle.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);

  const urls = calls.map((c) => c.url).sort();
  assert.deepEqual(urls, [
    `${API}catalog/goals.json`,
    `${API}catalog/markers.json`,
    `${API}commentary.json`,
    `${API}observations`,
    `${API}observations/2023.jsonl`,
    `${API}observations/2024.jsonl`,
    `${API}plan.json`,
    `${API}profile.json`,
  ]);

  for (const call of calls) {
    assert.ok(call.url.startsWith("https://api.github.com/"));
    assert.equal(call.init.headers.Authorization, "Bearer synthetic-token");
    assert.deepEqual(Object.keys(call.init.headers).sort(), ["Accept", "Authorization"]);
    assert.equal(call.init.cache, "no-store");
    const expected = call.url.endsWith("/observations")
      ? "application/vnd.github+json"
      : "application/vnd.github.raw+json";
    assert.equal(call.init.headers.Accept, expected, call.url);
    assert.ok(!call.url.includes("synthetic-token"));
  }
});

test("github mode writes the cache and readCache returns it", async () => {
  stubFetch(githubRoutes());
  assert.equal(readCache(), null);
  const bundle = await loadBundle(githubSource);
  assert.deepEqual(readCache(), bundle);
});

test("missing observations directory gives an empty list", async () => {
  stubFetch(githubRoutes({ [`${API}observations`]: reply(404, { message: "Not Found" }) }));
  const bundle = await loadBundle(githubSource);
  assert.deepEqual(bundle.observations, []);
});

test("401 maps to auth", async () => {
  stubFetch(githubRoutes({ [`${API}profile.json`]: reply(401, "") }));
  await assert.rejects(loadBundle(githubSource), (e) => e instanceof DataError && e.code === "auth");
});

test("403 maps to auth", async () => {
  stubFetch(githubRoutes({ [`${API}catalog/markers.json`]: reply(403, "") }));
  await assert.rejects(loadBundle(githubSource), (e) => e instanceof DataError && e.code === "auth");
});

test("404 on profile.json maps to not_found", async () => {
  stubFetch(githubRoutes({ [`${API}profile.json`]: reply(404, "") }));
  await assert.rejects(loadBundle(githubSource), (e) => e instanceof DataError && e.code === "not_found");
});

test("rejected fetch maps to network", async () => {
  stubFetch(githubRoutes({ [`${API}profile.json`]: new TypeError("Failed to fetch") }));
  await assert.rejects(loadBundle(githubSource), (e) => e instanceof DataError && e.code === "network");
});

test("bad JSON maps to format and names the file", async () => {
  stubFetch(githubRoutes({ [`${API}catalog/goals.json`]: reply(200, "{not json") }));
  await assert.rejects(
    loadBundle(githubSource),
    (e) => e instanceof DataError && e.code === "format" && e.message.includes("catalog/goals.json"),
  );
});

test("bad JSONL maps to format and names the file", async () => {
  stubFetch(githubRoutes({ [`${API}observations/2024.jsonl`]: reply(200, "{broken\n") }));
  await assert.rejects(
    loadBundle(githubSource),
    (e) => e instanceof DataError && e.code === "format" && e.message.includes("observations/2024.jsonl"),
  );
});

test("failed load does not write the cache", async () => {
  stubFetch(githubRoutes({ [`${API}profile.json`]: reply(401, "") }));
  await assert.rejects(loadBundle(githubSource));
  assert.equal(readCache(), null);
});

test("local mode probes year files, ignores 404 and never touches storage", async () => {
  const year = new Date().getFullYear();
  const base = "/synthetic-data";
  stubFetch({
    [`${base}/profile.json`]: reply(200, profile),
    [`${base}/catalog/goals.json`]: reply(200, goals),
    [`${base}/catalog/markers.json`]: reply(200, catalog),
    [`${base}/observations/${year}.jsonl`]: reply(200, JSON.stringify(obs(`${year}-02-01`, 9)) + "\n"),
    [`${base}/observations/${year - 2}.jsonl`]: reply(200, JSON.stringify(obs(`${year - 2}-02-01`, 7)) + "\n"),
  });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ repo: "owner/repo", token: "t" }));
  const before = [...localStorage.map.entries()];

  const bundle = await loadBundle({ mode: "local", base });

  assert.deepEqual(
    bundle.observations.map((o) => o.value),
    [7, 9],
  );
  assert.equal(calls.length, 5 + 30);
  assert.ok(calls.every((c) => c.url.startsWith(base + "/")));
  assert.ok(calls.every((c) => !c.init?.headers?.Authorization));
  assert.equal(localStorage.getItem(CACHE_KEY), null);
  assert.deepEqual([...localStorage.map.entries()], before);
});

test("local mode: 404 on profile.json maps to not_found", async () => {
  stubFetch({});
  await assert.rejects(
    loadBundle({ mode: "local", base: "/synthetic-data" }),
    (e) => e instanceof DataError && e.code === "not_found",
  );
});

const commentary = {
  version: 1,
  as_of: "2024-06-01",
  written: "2024-06-02",
  author: "synthetic-model",
  summary: { headline: "Synthetic headline", text: "Synthetic text." },
  domains: { d1: { headline: "Domain headline", text: "Domain text." } },
  markers: { m1: "Marker note." },
};

test("github mode returns and caches commentary when present", async () => {
  stubFetch(githubRoutes({ [`${API}commentary.json`]: reply(200, commentary) }));
  const bundle = await loadBundle(githubSource);
  assert.deepEqual(bundle.commentary, commentary);
  assert.deepEqual(readCache().commentary, commentary);
  const call = calls.find((c) => c.url === `${API}commentary.json`);
  assert.deepEqual(Object.keys(call.init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(call.init.headers.Accept, "application/vnd.github.raw+json");
});

test("github mode: 404 on commentary.json gives commentary null", async () => {
  stubFetch(githubRoutes());
  const bundle = await loadBundle(githubSource);
  assert.equal(bundle.commentary, null);
  assert.equal(readCache().commentary, null);
});

test("github mode: an unusable commentary.json does not block the data", async () => {
  for (const body of ["{not json", "[1, 2]", "null"]) {
    stubFetch(githubRoutes({ [`${API}commentary.json`]: reply(200, body) }));
    const bundle = await loadBundle(githubSource);
    assert.equal(bundle.commentary, null);
    assert.equal(bundle.observations.length > 0, true);
  }
});

test("github mode: 401 on commentary.json maps to auth", async () => {
  stubFetch(githubRoutes({ [`${API}commentary.json`]: reply(401, "") }));
  await assert.rejects(loadBundle(githubSource), (e) => e instanceof DataError && e.code === "auth");
});

test("local mode: commentary present is returned, 404 and unusable files give null", async () => {
  const base = "/synthetic-data";
  const routes = {
    [`${base}/profile.json`]: reply(200, profile),
    [`${base}/catalog/goals.json`]: reply(200, goals),
    [`${base}/catalog/markers.json`]: reply(200, catalog),
  };
  stubFetch({ ...routes, [`${base}/commentary.json`]: reply(200, commentary) });
  assert.deepEqual((await loadBundle({ mode: "local", base })).commentary, commentary);

  stubFetch(routes);
  assert.equal((await loadBundle({ mode: "local", base })).commentary, null);

  stubFetch({ ...routes, [`${base}/commentary.json`]: reply(200, "[oops") });
  assert.equal((await loadBundle({ mode: "local", base })).commentary, null);
});

test("readCache fills commentary null for a cache written before the key existed", () => {
  const old = { profile, goals, catalog, observations: [], fetchedAt: "2024-01-01T00:00:00.000Z" };
  localStorage.setItem(CACHE_KEY, JSON.stringify(old));
  assert.deepEqual(readCache(), { ...old, commentary: null, plan: null });
});

const plan = {
  version: 1,
  written: "2024-06-02",
  author: "synthetic-model",
  items: { m1: { due: "2024-07-01", priority: "high", effort: "Synthetic effort", reason: "Synthetic reason." } },
};

test("github mode returns and caches plan when present", async () => {
  stubFetch(githubRoutes({ [`${API}plan.json`]: reply(200, plan) }));
  const bundle = await loadBundle(githubSource);
  assert.deepEqual(bundle.plan, plan);
  assert.deepEqual(readCache().plan, plan);
  const call = calls.find((c) => c.url === `${API}plan.json`);
  assert.deepEqual(Object.keys(call.init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(call.init.headers.Accept, "application/vnd.github.raw+json");
});

test("github mode: 404 on plan.json gives plan null", async () => {
  stubFetch(githubRoutes());
  const bundle = await loadBundle(githubSource);
  assert.equal(bundle.plan, null);
  assert.equal(readCache().plan, null);
});

test("github mode: an unusable plan.json does not block the data", async () => {
  for (const body of ["{not json", "[1]", "null"]) {
    stubFetch(githubRoutes({ [`${API}plan.json`]: reply(200, body) }));
    const bundle = await loadBundle(githubSource);
    assert.equal(bundle.plan, null, body);
    assert.deepEqual(
      bundle.observations.map((o) => o.value),
      [1, 2, 3],
    );
  }
});

test("github mode: 401 on plan.json maps to auth", async () => {
  stubFetch(githubRoutes({ [`${API}plan.json`]: reply(401, "") }));
  await assert.rejects(loadBundle(githubSource), (e) => e instanceof DataError && e.code === "auth");
});

test("local mode: plan present is returned, 404 and unusable files give null", async () => {
  const base = "/synthetic-data";
  const routes = {
    [`${base}/profile.json`]: reply(200, profile),
    [`${base}/catalog/goals.json`]: reply(200, goals),
    [`${base}/catalog/markers.json`]: reply(200, catalog),
  };
  stubFetch({ ...routes, [`${base}/plan.json`]: reply(200, plan) });
  assert.deepEqual((await loadBundle({ mode: "local", base })).plan, plan);

  stubFetch(routes);
  assert.equal((await loadBundle({ mode: "local", base })).plan, null);

  for (const body of ["{not json", "[1]", "null"]) {
    stubFetch({ ...routes, [`${base}/plan.json`]: reply(200, body) });
    assert.equal((await loadBundle({ mode: "local", base })).plan, null, body);
  }
});

test("readCache fills plan null for a cache written before the key existed", () => {
  const old = { profile, goals, catalog, observations: [], commentary, fetchedAt: "2024-01-01T00:00:00.000Z" };
  localStorage.setItem(CACHE_KEY, JSON.stringify(old));
  assert.deepEqual(readCache(), { ...old, plan: null });
});
