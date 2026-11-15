// Small Markdown subset for the guest summary: #..### headings, paragraphs,
// "-" lists, pipe tables and **bold**. Everything else is plain text.
// parseMarkdown is pure (testable without a DOM); renderMarkdown builds nodes with h().
import { h } from "./dom.js";

/** @returns {{text: string, bold: boolean}[]} */
function inline(text) {
  const runs = [];
  const parts = String(text).split("**");
  // an odd number of markers leaves the last one unclosed: it stays literal text
  const closed = parts.length % 2 === 1 ? parts.length : parts.length - 1;
  let literal = "";
  parts.forEach((part, i) => {
    if (i < closed) {
      if (part) runs.push({ text: part, bold: i % 2 === 1 });
    } else {
      literal += (i === closed ? "**" : "") + part;
    }
  });
  if (literal) runs.push({ text: literal, bold: false });
  // merge neighbours with the same weight
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

const isTableLine = (l) => l.trim().startsWith("|");
const isSeparator = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");

/**
 * @param {string} text
 * @returns {Array<
 *   {type: "heading", level: 1|2|3, inline: object[]} |
 *   {type: "paragraph", inline: object[]} |
 *   {type: "list", items: object[][]} |
 *   {type: "table", header: object[][], rows: object[][][]}>}
 */
export function parseMarkdown(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const hm = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hm) {
      blocks.push({ type: "heading", level: hm[1].length, inline: inline(hm[2].trim()) });
      i += 1;
      continue;
    }

    if (isTableLine(line) && i + 1 < lines.length && isTableLine(lines[i + 1]) && isSeparator(lines[i + 1])) {
      const header = splitRow(line).map(inline);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i])) {
        const cells = splitRow(lines[i]).map(inline);
        rows.push(cells);
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        if (/^-\s+/.test(lines[i])) items.push(lines[i].replace(/^-\s+/, "").trim());
        else if (/^ {2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += " " + lines[i].trim();
        else break;
        i += 1;
      }
      blocks.push({ type: "list", items: items.map(inline) });
      continue;
    }

    const parts = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s+/.test(lines[i]) && !/^-\s+/.test(lines[i])
      && !(isTableLine(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1] || ""))) {
      parts.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", inline: inline(parts.join(" ")) });
  }
  return blocks;
}

function runsToNodes(runs) {
  return runs.map((r) => (r.bold ? h("strong", null, r.text) : r.text));
}

/** @returns {Node[]} */
export function renderMarkdown(text) {
  return parseMarkdown(text).map((b) => {
    if (b.type === "heading") return h("h" + (b.level + 1), null, ...runsToNodes(b.inline));
    if (b.type === "list") return h("ul", null, ...b.items.map((it) => h("li", null, ...runsToNodes(it))));
    if (b.type === "table") {
      return h("div", { class: "table-wrap" },
        h("table", null,
          h("thead", null, h("tr", null, ...b.header.map((c) => h("th", null, ...runsToNodes(c))))),
          h("tbody", null, ...b.rows.map((r) => h("tr", null, ...r.map((c) => h("td", null, ...runsToNodes(c))))))));
    }
    return h("p", null, ...runsToNodes(b.inline));
  });
}
