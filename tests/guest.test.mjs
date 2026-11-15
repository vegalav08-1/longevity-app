import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";

globalThis.localStorage = {
  getItem: (k) => { throw new Error("localStorage must not be read in guest mode: " + k); },
  setItem: (k) => { throw new Error("localStorage must not be written in guest mode: " + k); },
  removeItem: () => {},
};
globalThis.location = { search: "" };

const { parseGuestRoute, loadGuestBundle, decryptSnapshot, DataError } = await import("../src/data.js");
const { parseMarkdown } = await import("../src/markdown.js");

const ID = "0123456789abcdef01234567";
const OTHER_ID = "fedcba9876543210fedcba98";
const BASE = "https://example.test/longevity-app/";
const b64 = (buf) => Buffer.from(buf).toString("base64url");

function bundle(extra = {}) {
  return {
    version: 1, label: "Тест", created: "2026-01-01", expires: "2099-12-31", as_of: "2026-02-02",
    profile: { version: 1, birth_date: "1990-01-01", sex: "m" },
    goals: { version: 1, mission: "m", groups: [], domains: [] },
    catalog: { version: 1, panels: {}, markers: [] },
    observations: [{ date: "2026-01-01", marker: "x", value: 1, unit: "u", verified: true }],
    commentary: null, plan: null, summary: "# Заголовок\n\nТекст.",
    ...extra,
  };
}

function encrypt(obj, id = ID, keyBytes = randomBytes(32)) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes, iv);
  c.setAAD(Buffer.from(id));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), "utf8")), c.final()]);
  const file = { v: 1, alg: "A256GCM", iv: b64(iv), ct: b64(Buffer.concat([ct, c.getAuthTag()])) };
  return { file, key: b64(keyBytes) };
}

function stub(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetchImpl };
}
const ok = (file) => ({ ok: true, status: 200, text: async () => JSON.stringify(file) });
const status = (code) => ({ ok: false, status: code, text: async () => "" });

async function code(promise) {
  try { await promise; } catch (e) { assert.ok(e instanceof DataError); return e.code; }
  return null;
}

test("parseGuestRoute accepts valid links", () => {
  const key = "A".repeat(43);
  assert.deepEqual(parseGuestRoute(`#/guest/${ID}/${key}`), { id: ID, key, rest: [] });
  assert.deepEqual(parseGuestRoute(`#/guest/${ID}/${key}/plan`), { id: ID, key, rest: ["plan"] });
  assert.deepEqual(parseGuestRoute(`#/guest/${ID}/${key}/marker/a%20b`), { id: ID, key, rest: ["marker", "a b"] });
});

test("parseGuestRoute rejects bad id, bad key and other hashes", () => {
  const key = "A".repeat(43);
  assert.equal(parseGuestRoute(`#/guest/${ID.toUpperCase()}/${key}`), null);
  assert.equal(parseGuestRoute(`#/guest/${ID.slice(1)}/${key}`), null);
  assert.equal(parseGuestRoute(`#/guest/${ID}/${key.slice(1)}`), null);
  assert.equal(parseGuestRoute(`#/guest/${ID}/${key}=`), null);
  assert.equal(parseGuestRoute(`#/guest/${ID}`), null);
  assert.equal(parseGuestRoute("#/plan"), null);
  assert.equal(parseGuestRoute(""), null);
});

test("round trip: URL, cache mode, guest fields and summary", async () => {
  const { file, key } = encrypt(bundle());
  const { calls, fetchImpl } = stub(ok(file));
  const result = await loadGuestBundle({ id: ID, key }, { fetchImpl, baseUrl: BASE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://example.test/longevity-share/${ID}.json`);
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(result.guest, { label: "Тест", created: "2026-01-01", expires: "2099-12-31", asOf: "2026-02-02" });
  assert.equal(result.summary, "# Заголовок\n\nТекст.");
  assert.equal(result.observations.length, 1);
  assert.equal(result.commentary, null);
  assert.equal(result.plan, null);
  assert.ok(result.fetchedAt);
});

test("wrong key, tampered ct and AAD mismatch give format", async () => {
  const { file, key } = encrypt(bundle());
  const wrong = b64(randomBytes(32));
  assert.equal(await code(loadGuestBundle({ id: ID, key: wrong }, { fetchImpl: stub(ok(file)).fetchImpl, baseUrl: BASE })), "format");

  const raw = Buffer.from(file.ct, "base64url");
  raw[0] ^= 1;
  const tampered = { ...file, ct: b64(raw) };
  assert.equal(await code(loadGuestBundle({ id: ID, key }, { fetchImpl: stub(ok(tampered)).fetchImpl, baseUrl: BASE })), "format");

  const swapped = encrypt(bundle(), OTHER_ID);
  assert.equal(await code(loadGuestBundle({ id: ID, key: swapped.key }, { fetchImpl: stub(ok(swapped.file)).fetchImpl, baseUrl: BASE })), "format");
});

test("decryptSnapshot validates the file shape", async () => {
  const { file, key } = encrypt(bundle());
  assert.equal(await code(decryptSnapshot({ ...file, v: 2 }, ID, key)), "format");
  assert.equal(await code(decryptSnapshot({ ...file, alg: "x" }, ID, key)), "format");
  assert.equal(await code(decryptSnapshot({ ...file, iv: 5 }, ID, key)), "format");
  assert.equal(await code(decryptSnapshot({ ...file, ct: "!!!" }, ID, key)), "format");
  assert.equal(await code(decryptSnapshot(null, ID, key)), "format");
});

test("404 is not_found, rejected fetch and other statuses are network", async () => {
  const key = b64(randomBytes(32));
  assert.equal(await code(loadGuestBundle({ id: ID, key }, { fetchImpl: stub(status(404)).fetchImpl, baseUrl: BASE })), "not_found");
  assert.equal(await code(loadGuestBundle({ id: ID, key }, { fetchImpl: stub(new Error("offline")).fetchImpl, baseUrl: BASE })), "network");
  assert.equal(await code(loadGuestBundle({ id: ID, key }, { fetchImpl: stub(status(500)).fetchImpl, baseUrl: BASE })), "network");
});

test("expired access, last day still works", async () => {
  const { file, key } = encrypt(bundle({ expires: "2026-03-10" }));
  const run = (today) => loadGuestBundle({ id: ID, key }, { fetchImpl: stub(ok(file)).fetchImpl, baseUrl: BASE, today });
  assert.equal(await code(run("2026-03-11")), "expired");
  const result = await run("2026-03-10");
  assert.equal(result.guest.expires, "2026-03-10");
  try { await run("2026-03-11"); } catch (e) { assert.match(e.message, /^Срок доступа истёк 10 марта 2026 г\.\./); }
});

test("bundle with a wrong shape gives format", async () => {
  const bad = encrypt(bundle({ observations: "nope" }));
  assert.equal(await code(loadGuestBundle({ id: ID, key: bad.key }, { fetchImpl: stub(ok(bad.file)).fetchImpl, baseUrl: BASE })), "format");
  const noGoals = encrypt(bundle({ goals: undefined }));
  assert.equal(await code(loadGuestBundle({ id: ID, key: noGoals.key }, { fetchImpl: stub(ok(noGoals.file)).fetchImpl, baseUrl: BASE })), "format");
});

test("missing summary becomes null", async () => {
  const { file, key } = encrypt(bundle({ summary: null }));
  const result = await loadGuestBundle({ id: ID, key }, { fetchImpl: stub(ok(file)).fetchImpl, baseUrl: BASE });
  assert.equal(result.summary, null);
});

test("parseMarkdown: headings, paragraphs, list, table, bold", () => {
  const text = [
    "# Один", "## Два", "### Три", "",
    "Первая строка", "вторая **важно** строка", "",
    "- пункт один", "  продолжение", "- пункт **два**", "",
    "| A | B |", "|---|---|", "| 1 | **2** |", "| 3 | 4 |", "",
    "Конец",
  ].join("\n");
  const blocks = parseMarkdown(text);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "heading", "heading", "paragraph", "list", "table", "paragraph"]);
  assert.deepEqual(blocks.slice(0, 3).map((b) => b.level), [1, 2, 3]);
  assert.deepEqual(blocks[0].inline, [{ text: "Один", bold: false }]);
  assert.deepEqual(blocks[3].inline, [
    { text: "Первая строка вторая ", bold: false }, { text: "важно", bold: true }, { text: " строка", bold: false }]);
  assert.deepEqual(blocks[4].items, [
    [{ text: "пункт один продолжение", bold: false }],
    [{ text: "пункт ", bold: false }, { text: "два", bold: true }]]);
  assert.deepEqual(blocks[5].header, [[{ text: "A", bold: false }], [{ text: "B", bold: false }]]);
  assert.equal(blocks[5].rows.length, 2);
  assert.deepEqual(blocks[5].rows[0][1], [{ text: "2", bold: true }]);
});

test("parseMarkdown: unclosed bold stays literal, other syntax is plain text", () => {
  const blocks = parseMarkdown("a **b\n\n1. x\n\n#### no");
  assert.deepEqual(blocks[0].inline, [{ text: "a **b", bold: false }]);
  assert.equal(blocks[1].type, "paragraph");
  assert.equal(blocks[2].type, "paragraph");
});
