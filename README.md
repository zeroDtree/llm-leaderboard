# llm-leaderboard

Scrapes the [Artificial Analysis](https://artificialanalysis.ai/leaderboards/models) LLM
leaderboard and lets you browse and filter it locally — from a small web UI or the command line.

Built on [Cordis](https://github.com/cordiverse/cordis) v4 as four independent services.

```bash
pnpm install
pnpm refresh            # scrape ~704 models into .cache/
pnpm serve              # then open http://127.0.0.1:3000
```

No API key, no browser automation. The leaderboard page publishes every model record in its
own payload; this reads it directly.

## Commands

```
llm-leaderboard refresh [--cache <dir>]
llm-leaderboard serve   [--cache <dir>] [--view <file>] [--port <n>] [--host <addr>]
llm-leaderboard filter <expression> [--sort <field>] [--order asc|desc]
                                    [--limit <n>] [--offset <n>] [--json | --csv]
llm-leaderboard fields  [--search <text>]
```

```bash
llm-leaderboard filter 'price < 1'
llm-leaderboard filter 'price < 1 and intelligence > 40' --sort price --order asc
llm-leaderboard filter 'creator in (Anthropic, OpenAI)' --limit 20
llm-leaderboard filter 'not deprecated' --csv > models.csv
```

Diagnostics go to stderr, so `--json` and `--csv` pipe cleanly.

## Filter expressions

| | | |
|---|---|---|
| Comparisons | `<` `<=` `>` `>=` `==` `=` `!=` | `price < 1` |
| Contains | `~` `!~` | `name ~ claude` |
| Set membership | `in (…)` | `creator in (Anthropic, OpenAI)` |
| Logic | `and` `&&` `or` `\|\|` `not` `!` | `price < 1 and not deprecated` |
| Grouping | `( … )` | `(price < 0.5 or price > 100) and openWeights` |

Juxtaposition is `and`, so `price < 1 openWeights` works. A bare field asserts it has a
value, which makes `not deprecated` read as written.

### Two semantics worth knowing

**`price` is blended.** Artificial Analysis quotes input and output prices separately;
`price` is their own 3:1 blend, `(3 × input + output) / 4`. Use `inputPrice` / `outputPrice`
for the raw figures.

**Missing data satisfies no comparison.** 249 of 704 models publish no price, and a third
omit the performance block entirely. `price < 1` excludes them rather than treating them as
free, and `price != 0` excludes them rather than sweeping them in. Only `price == null`
matches them; use `not (…)` when you want the looser reading.

### Fields

`llm-leaderboard fields` lists everything — 54 fields, including derived ones and aliases.
Every published field is filterable under its own name, plus short aliases:

| Alias | Field |
|---|---|
| `price`, `cost` | blended 3:1 price |
| `intelligence`, `index`, `iq` | `intelligenceIndex` |
| `inputPrice`, `outputPrice` | raw per-1M prices |
| `creator`, `vendor` | `modelCreatorName` |
| `speed`, `tps` | median output tokens/sec |
| `ttft`, `latency` | time to first token / end-to-end |
| `context`, `openWeights`, `reasoning`, `released`, `age` | — |

## The saved view

Your filter, sort order and columns are remembered. Change any of them and the view is
written to `view.json` in the project root, so reopening the page puts you back exactly
where you left off — no re-typing a filter.

```json
{
  "version": 1,
  "filter": "price < 1 and intelligence > 40",
  "sort": "price",
  "order": "asc",
  "columns": ["name", "modelCreatorName", "intelligenceIndex", "price"]
}
```

It is a plain file, so you can edit it by hand, keep it in version control, or diff it.
Point it somewhere else with `--view <file>`.

**Export** downloads the current view; **Import** loads one back. Both go through the same
normalization as everything else, so a hand-written file with an alias (`creator`) or a
column that no longer exists still loads — unknown parts fall back to their defaults rather
than failing the whole file.

A few deliberate choices:

- **It saves itself.** There is no "Save" button; changes are written 500 ms after you stop
  typing, and a pending edit is flushed if you close the tab.
- **An unfinished filter is a valid thing to save.** Expressions are stored verbatim — the
  page reports syntax errors live, so there is no reason to refuse to keep one.
- **Field names are canonicalized on the way in.** `intelligence` becomes `intelligenceIndex`,
  `creator` becomes `modelCreatorName`, duplicates are dropped. A saved view cannot rot into
  a set of names that half-work.

## Web UI

- **Filter box** with live match count and inline errors (with a caret at the offending
  character)
- **Price vs intelligence scatter** — blended price on a log axis, drawn as focus-and-context:
  the whole leaderboard stays visible in grey while the filter's matches are highlighted, so
  you can see what a filter *excluded*. The orange line is the best-value frontier: the
  cheapest model to reach each intelligence level.
- **Sortable table** with a column picker over all 54 fields
- **Filter, sort and columns persist** across sessions — see [the saved view](#the-saved-view)
  — with Export/Import for moving a view between machines
- Light and dark themes; hover any point for detail

## Architecture

Four Cordis services, each independently loadable and unloadable:

| Service | Injects | Responsibility |
|---|---|---|
| `store` | — | Snapshots in `.cache/` |
| `aa` | `store` | Fetch and parse the page into records |
| `query` | — | Compile a filter expression; filter, sort, page |
| `view` | — | The saved filter, sort and columns, as JSON on disk |
| `server` | `aa`, `query`, `view` | HTTP API and the viewer |

`aa` is the only module that knows the page's payload format, so a format change is a
one-file fix. Adding a service needs no changes elsewhere — Cordis resolves it and reloads
dependents automatically.

The filter engine (`src/filter.ts`) is a hand-written lexer and recursive-descent parser. It
compiles to a tree of closures over field accessors — no `eval`, so there is no code-injection
surface, and an unknown field is a positioned `FilterError` rather than a `ReferenceError`.

### API

```
GET  /api/models?filter=<expr>&sort=<field>&order=asc|desc&limit=&offset=
GET  /api/fields
GET  /api/view             the saved view (defaults if nothing is saved yet)
PUT  /api/view             replace it; the body is normalized, not rejected
POST /api/refresh
```

## Development

```bash
pnpm test        # 24 tests: filter semantics and page parsing
pnpm typecheck
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Parsing tests run against a synthetic page, so they are deterministic and offline.

## Notes

**Node 22+** is required (Cordis v4 is ESM-only).

**`tsconfig.json` uses `moduleResolution: "bundler"`.** Cordis ships `lib/index.d.ts` with
extensionless relative imports (`export * from './service'`), which Node's ESM resolution
rules reject — under `nodenext` TypeScript cannot see Cordis's own type exports. Bundler
resolution permits them and still honours the exports map. Our own imports keep explicit
`.js` extensions, so the emitted ESM runs unchanged on Node.

**Cordis v4 is a release candidate** (`4.0.0-rc.11`, the current `latest`). The version is
pinned exactly. Be aware that most Cordis material online documents v3 — the Koishi-era API
with `super(ctx, name, true)` and `inject: { required, optional }` — and that the official
docs site is a parked redirect. The shipped `.d.ts` files are the reliable reference.

**Scraping.** The endpoint is a public page, `robots.txt` is `Allow: /`, requests are
identified with a custom User-Agent, and nothing here authenticates or bypasses a control.
`refresh` refuses to overwrite a cached snapshot if the page stops parsing, so a format
change fails loudly instead of silently writing an empty leaderboard.

**Attribution.** The data is Artificial Analysis's; their terms require credit, which the UI
and this README provide. Their v2 data API (401 without a key) is being retired on
2026-11-04 in favour of a keyed `/api/v2/language/models`, so if you need a supported
interface, get a key and swap `src/aa.ts` — the rest of the app is indifferent to where
records come from.
