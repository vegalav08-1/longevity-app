# Longevity app: architecture and contracts

This file is the source of truth for both repositories. Code that disagrees with
it is wrong; change the contract here first, then the code.

## Two repositories

| Repository | Visibility | Holds |
|---|---|---|
| `longevity-app` | public | Static web app. No personal data, ever. |
| `longevity-data` | private | Profile, catalog, observations, raw lab documents. |

The app is served as static files (GitHub Pages). It reads the private data
repository from the browser through the GitHub REST API with a fine-grained
token that the owner pastes once on the device. There is no backend.

## Hard rules

1. No personal data in `longevity-app`: no real values, names, dates of birth,
   lab order numbers. Tests and examples use synthetic numbers only.
2. No third-party code, fonts, CDNs or analytics. Zero runtime dependencies,
   no build step. Plain ES modules, plain CSS.
3. Never put data into `innerHTML`. Build DOM with `createElement` and
   `textContent` (see `src/dom.js`).
4. The token lives only in `localStorage` and is sent only to
   `https://api.github.com`.
5. Light theme only. `color-scheme: light`. No dark mode.
6. All paths relative (the app is served from `/longevity-app/`).
7. Technical names (files, variables, ids) are English words, never
   transliteration. Interface text is Russian, sentence case.
8. An LLM never runs at display time. Statuses come from fixed thresholds in
   the catalog and the pure functions in `src/engine.js`.

## Data contract (`longevity-data`)

```
profile.json                  {version, birth_date: "YYYY-MM-DD", sex}
catalog/goals.json            {version, mission, groups: [{id, name}], domains: [{id, name, goal, group}]}
catalog/markers.json          {version, panels: {panelId: title}, markers: [MarkerDef]}
observations/YYYY.jsonl       one Observation per line, file chosen by the year of `date`
commentary.json              optional, see Commentary
plan.json                    optional, see Plan targets
raw/                          source documents, named YYYY-MM-DD_<lab>_<order>.<ext>
notes/                        curator notes in Markdown (history, intake, logs); the app never reads them
tools/validate.mjs            `node tools/validate.mjs` must pass before every commit
```

### MarkerDef

```
id              string, snake_case, unique
name            string, Russian display name
short_name      optional short label for charts ("HOMA-IR")
unit            canonical unit string, "" for unitless
unit_label      Russian display unit
domain          id from goals.json
panel           optional id from `panels`; markers of one panel are sampled together
role            "primary" | "secondary"   (secondary never affects a domain status)
kind            "measured" | "derived"
formula, inputs only for derived: formula name in engine, input marker ids
decimals        digits after the decimal separator when displayed
recheck_months  number | null | absent. null = no routine recheck
recheck_note    optional text shown when recheck_months is null
ref             optional {low?, high?}: fallback reference range
optimal         optional {low?, high?}: stricter target inside the reference range
basis           optional text: where the ref/optimal threshold comes from
why             text: why this marker is tracked
```

### Observation

```
date        "YYYY-MM-DD"  date of sampling
marker      MarkerDef.id
value       number
comparator  optional "<" | ">"  (censored result such as "<3.2")
unit        must equal MarkerDef.unit
ref_low     optional number, reference range printed on the lab report
ref_high    optional number
lab         optional string
order       optional string, lab order id
source      optional path inside the data repo (raw/...), or "chat" for a value the owner dictated to the curator
verified    boolean. true only for values read from a text-layer PDF or confirmed by the owner
note        optional string
```

The reference range printed on the report travels with the observation because
ranges differ between labs and methods. `MarkerDef.ref` is only a fallback.

### Commentary

Interpretation written by a language model at the moment data is added, never
at display time. The app shows it next to the numbers; the numbers and statuses
never depend on it.

```
commentary.json = {
  version,
  as_of      "YYYY-MM-DD"  date of the newest observation the text accounts for
  written    "YYYY-MM-DD"
  author     string, the model that wrote it
  summary    {headline, text}
  domains    {[domainId]: {headline, text}}
  markers    {[markerId]: text}
}
```

Rules for the text: conclusion first; about this person's values and their
dynamics, not a textbook description of the marker (that is `MarkerDef.why`);
no drug names, doses or treatment regimens; say what a result does not show.
`headline` up to 8 words. Marker text up to 3 sentences, domain text up to 4.
A marker with nothing specific to say has no entry. A comment is shown as
outdated when the marker has an observation newer than `as_of`.

### Plan targets

Deadlines and priorities that cannot be derived from the data: when a marker
that has never been measured should first be measured, and how much it matters.
Written by a model when data is added, like the commentary.

```
plan.json = {
  version,
  written   "YYYY-MM-DD"
  author    string
  items     {[markerId]: {due: "YYYY-MM-DD", priority: "high" | "medium" | "low",
                          effort?: string, reason?: string, handoff?: string}}
  routine?  [{title, when, what, handoff?}]     recurring data the owner sends
  curator?  {name, where}                        who enters the data and where to send it
}
```

`effort` says what it takes ("Опросник, 5 минут"), `reason` says why now,
`handoff` is the message the owner sends to the curator, ready to copy.

The app is read-only. Data enters the repository through the curator: a
language-model chat with access to the data repository. The owner sends values
or documents there; the curator validates them, writes observations, rewrites
the commentary and the plan. `routine` lists what is sent on a schedule.
A marker that already has data ignores `due` (its date comes from
`recheck_months`) but keeps `priority`, `effort` and `reason`. One exception:
when that recheck date has already passed and the target's `due` is later, the
target's `due` is used. This is the case of imported old results, where the
interval-based date lies years in the past and the curator has set the real one.

## Engine contract (`src/engine.js`)

Pure ES module. No DOM, no network, no `Date.now()` (today is passed in).

```js
parseJsonl(text) -> object[]          // skips blank lines; throws Error naming the line number
ageAt(birthDate, date) -> integer     // whole years
formatValue(value, decimals, comparator) -> string   // comma decimal separator: "12,30", "<0,5"
evaluateStatus(value, comparator, ref, optimal) -> Status
positionFor(value, ref) -> number | null             // strip coordinate, rules below
addMonths(date, months) -> "YYYY-MM-DD"              // calendar months, day clamped to month end
formulas[name](inputs, context) -> number             // inputs: values in MarkerDef.inputs order; context: {age}
buildModel({profile, goals, catalog, observations, plan, today}) -> Model   // plan: plan.json or null
```

`Status` is one of `"optimal" | "watch" | "out" | "unrated"`; marker and domain
states may also be `"nodata"`.

### evaluateStatus

- `ref` and `optimal` are `{low?, high?}` or null.
- No bound in either → `"unrated"`.
- Value outside `ref` → `"out"`.
- Otherwise outside `optimal` → `"watch"`.
- Otherwise `"optimal"`.
- Comparator `"<"`: the true value is at most `value`. Low bounds are treated as
  satisfied, high bounds are checked against `value`. Comparator `">"` mirrors this.
- Bounds are inclusive: `value === ref.high` is inside.

### formulas

| name | inputs | result |
|---|---|---|
| `homa_ir` | glucose_fasting (mmol/L), insulin_fasting (uIU/mL) | glucose × insulin / 22.5 |
| `non_hdl` | cholesterol_total, hdl (mmol/L) | total − HDL |
| `free_testosterone_vermeulen` | testosterone_total, shbg (nmol/L), albumin (g/L) | nmol/L |
| `bioavailable_testosterone_vermeulen` | same | nmol/L, free × N |
| `fib4` | ast, alt (U/L), platelets (10^9/L); context.age | age × AST / (platelets × √ALT) |

Vermeulen: `Kt = 1e9 L/mol`, `Ka = 3.6e4 L/mol`, albumin molar mass 69000 g/mol,
`N = 1 + Ka × albumin_mol`. Free testosterone is the positive root of
`N·Kt·FT² + (N + Kt·(SHBG − T))·FT − T = 0` with all concentrations in mol/L.

Reference values for tests (synthetic inputs):

- T 20, SHBG 35, albumin 43 → free 0.4152 nmol/L, bioavailable 9.731 nmol/L
- age 40, AST 30, ALT 25, platelets 250 → FIB-4 0.96
- glucose 5.0, insulin 10 → HOMA-IR 2.222

### Model

```js
Model = {
  mission,                      // goals.mission
  groups,                       // goals.groups or []
  today,                        // "YYYY-MM-DD" as passed in
  lastObservationDate,          // max observation date or null
  domains: DomainState[],       // goals.json order
  markers: {[id]: MarkerState}, // every MarkerDef, with or without data
  plan: PlanItem[],
  routine,                      // plan.json routine or []
  curator,                      // plan.json curator or null
}

Point = {date, value, comparator?, ref: {low?, high?} | null, status: Status,
         derived: boolean, source?, lab?, verified?}

MarkerState = {
  def,                          // MarkerDef
  series: Point[],              // ascending by date
  latest: Point | null,
  status: Status | "nodata",    // status of latest
  ref,                          // effective ref of latest, or def.ref, or null
  position: number | null,      // 0..1 on the range bar, see below
  due: {state: "ok" | "soon" | "overdue" | "missing" | "none", date: string | null},
  priority: "high" | "medium" | "low",
  related: string[],            // derived → its inputs; measured → derived markers using it
}

DomainState = {
  id, name, goal, group,        // group: id from goals.groups or null
  markerIds: string[],          // catalog order
  status: Status | "nodata",    // worst over primary markers: out > watch > optimal
  counts: {optimal, watch, out, unrated, nodata},   // primary markers only
}

PlanItem = {key, title, state, date: string | null, markerIds: string[],
            priority, urgency, daysLeft: number | null,
            effort: string | null, reason: string | null, handoff: string | null}
```

Rules:

- Effective ref of a point: `{low: ref_low, high: ref_high}` when the observation
  has either; else `def.ref`; else null.
- Derived points: for every derived marker and every date on which all inputs
  have an observation, unless the derived marker itself has a measured
  observation on that date (measured wins). `derived: true`, ref = `def.ref`.
- Domain status ignores secondary markers and `unrated`. No primary marker with
  data → `"nodata"`. Primary data but none of it rated → `"unrated"`.
- `position`: band 0.25..0.75 is the effective ref range.
  both bounds: `0.25 + 0.5·(v − low)/(high − low)`; only high: `0.25 + 0.5·v/high`;
  only low: `0.25 + 0.5·(v − low)/low`; `high === low`: 0.5 if `v <= high` else 0.9.
  Clamp to 0.04..0.96. No ref → null.
- `due`: derived markers without `recheck_months` → `"none"`. A marker with no
  data → `"missing"` (derived markers are never missing). Data and
  `recheck_months` null/absent → `"none"`. Otherwise due date = latest date plus
  `recheck_months` calendar months: before today → `"overdue"`, within 30 days →
  `"soon"`, else `"ok"`.
- A missing marker takes its due date from `plan.items[id].due` (else null).
- `priority`: `plan.items[id].priority` when present; otherwise `"high"` for
  status out, `"medium"` for watch and for a missing marker, `"low"` for the rest.
- `plan`: markers grouped by `(panel, due.state, due.date)`; markers without a
  panel stand alone. Group title = panel title, or the marker name. Priority = highest in the group, effort, reason and handoff = the
  first non-empty among its markers in catalog order. State `"none"` is excluded.
- `daysLeft` = whole days from today to the date (negative when past), null
  without a date. `urgency`: `"overdue"` when daysLeft < 0, `"week"` for 0..7,
  `"month"` for 8..30, `"later"` above 30, `"none"` without a date.
- Plan order: date ascending with undated items last, then priority (high
  first), then title.

## Data layer contract (`src/data.js`)

```js
getSettings() -> {repo, token} | null       // from localStorage
saveSettings({repo, token})
clearDevice()                               // removes settings and cache
getSource() -> Source | null                // local mode if ?base= is valid, else settings, else null
Source = {mode: "local", base} | {mode: "github", repo, token}
readCache() -> Bundle | null                // github mode only
loadBundle(source) -> Promise<Bundle>       // fetches; in github mode also writes the cache
Bundle = {profile, goals, catalog, observations: Observation[], commentary: object | null,
          plan: object | null, fetchedAt: ISO string}
class DataError extends Error { code: "auth" | "not_found" | "network" | "format" }
```

GitHub mode: `GET https://api.github.com/repos/{repo}/contents/{path}` with
`Authorization: Bearer <token>` and no other custom header (each extra header must
pass the API's CORS preflight),
`Accept: application/vnd.github.raw+json` for files and
`application/vnd.github+json` for the `observations` directory listing
(keep entries named `YYYY.jsonl`).

Local mode for development and desktop use from a clone: the page is opened
with `?base=<same-origin path>`, for example `?base=/longevity-data`. Only a
path that starts with a single `/` is accepted. Files are fetched from
`<base>/profile.json` and so on; `observations/<year>.jsonl` is probed for the
last 30 years and 404 is ignored. Local mode never touches settings or cache.

## Interface

Routes (hash): `#/` today, `#/domain/<id>` (the today screen with that system
opened and scrolled into view), `#/marker/<id>`, `#/plan`, `#/curator`, `#/settings`. Bottom
tab bar: «Сегодня», «План», «Куратор», «Настройки».

The today screen is a three-level disclosure built from `<details>` elements.
Nothing below the first level is in the DOM until it is opened, and the set of
open sections survives re-renders and a visit to a marker page.

1. Lead block: the commentary summary (headline, text), the share of measured
   markers by status as one stacked bar with its tally, the author and date of
   the commentary.
2. One card per domain, listed under its group from `goals.groups`, problems
   first. Collapsed: name, status, the commentary headline, the system profile
   and a tally of marker statuses. The profile puts every primary marker of the
   system on one normalised scale, stacks marks that would overlap and labels
   each mark outside its target with its short name and value. The left edge of the card carries the status colour.
3. Opened domain: its commentary, then markers (each row carries a compact
   range bar, so the list reads as a panel of aligned gauges) in groups «Требуют внимания»,
   «В норме», «Не измерено», and a nested «Дополнительные показатели».
4. Opened marker: status and date, range bar, target, its commentary, `why`,
   the next recheck, and a link to the marker page.

- Marker page: value, status, range bar with numeric bounds, `basis`,
  commentary, `why`, history chart, table of all points, related markers,
  next recheck date or `recheck_note`.
- Plan: three figures (overdue, this week, important among them), a strip of
  the next eight days where a day with items is a filter, a priority filter,
  then items in deadline order under «Просрочено», «На этой неделе», «В этом
  месяце», «Позже», «Без срока». An item is a card: the deadline as a calendar
  leaf tinted by urgency, the title, priority and time-left chips, what it
  takes; its left edge carries the priority. Opened, it shows the reason, the
  message for the curator with a copy button, a "sent to the curator" mark kept
  on the device, and links to its markers.
- Curator: where data goes and how, the items the curator is waiting for this
  week, the schedule from `plan.routine`, the rules for handing data over.
- Today also has a filter of systems (all, flagged, without data).
- Settings: repository, token, load, refresh, delete data from this device.

Two surfaces, two meanings: white is data, the pale blue block is the model's
interpretation. That distinction is never broken.

### Design tokens

```
--ground #F2F4F8   --surface #FFFFFF   --line #DDE1EA
--ink #141B2D      --ink-2 #4A5368     --ink-3 #7A8296
--accent #2B3FA0   (interactive elements only)
--good #0CA30C  --good-text #006300
--watch #FAB219 --watch-text #7A5200
--out #D03B3B   --out-text #A82A2A
--nodata #B4BAC8
```

Headings: `ui-serif, "New York", Georgia, serif`, weight 600. Body:
`-apple-system, system-ui, "Segoe UI", Roboto, sans-serif`. Numbers use
`font-variant-numeric: tabular-nums`. Sizes 13 / 15 / 17 / 22 / 34 px.

Status is never colour alone: each status has a shape (optimal filled circle,
watch diamond, out triangle, no data hollow circle) and a word («В норме»,
«Внимание», «Вне нормы», «Нет данных», «Без нормы»).

## Development

```
cd <parent of both clones> && python3 -m http.server 8765
open http://localhost:8765/longevity-app/?base=/longevity-data
node --test                 # in longevity-app
node tools/validate.mjs     # in longevity-data
```

Interface acceptance (screenshots at phone widths plus interaction checks):
`python3 tools/acceptance.py <screenshot dir>`. Project status, decisions and the
backlog live in [ROADMAP.md](ROADMAP.md).
