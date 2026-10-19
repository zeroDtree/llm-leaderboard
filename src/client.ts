/**
 * The browser-facing entry point for the static GitHub Pages build.
 *
 * Bundled by `llm-leaderboard export` into `assets/client.js`, then imported by the
 * viewer so that filtering, sorting, field coverage and view normalization are the same
 * code paths the local server uses. Nothing reachable from here may import cordis or a
 * Node built-in — this module ships to a browser.
 */
export { runQuery, type QueryOptions, type QueryResult } from './query-core.js'
export { FilterError } from './filter.js'
export { FIELDS, coverage, materialize } from './fields.js'
export { DEFAULT_VIEW, normalizeView, VIEW_VERSION, type View } from './view-config.js'
