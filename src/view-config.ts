import { findField } from './fields.js'

/**
 * A saved viewing configuration: what you are looking at, not what the data says.
 *
 * Persisted as plain JSON at a known path so it survives a restart, can be opened in an
 * editor, kept in version control, or handed to someone else. The static GitHub Pages
 * build keeps the same shape in localStorage.
 */
export interface View {
  /** Format marker. Lets a future change recognise a file it should not try to read. */
  version: number
  /** A filter expression, kept verbatim — an unfinished one is a legitimate thing to save. */
  filter: string
  /** Canonical field name; aliases are resolved on the way in. */
  sort: string
  order: 'asc' | 'desc'
  /** Canonical field names, in the order they should appear. */
  columns: string[]
}

export const VIEW_VERSION = 1

/** Guard against a runaway file; no real expression comes close. */
const MAX_FILTER_LENGTH = 10_000

export const DEFAULT_VIEW: View = {
  version: VIEW_VERSION,
  filter: '',
  sort: 'intelligenceIndex',
  order: 'desc',
  columns: [
    'name', 'modelCreatorName', 'isReasoning', 'intelligenceIndex', 'price',
    'price1mInputTokens', 'price1mOutputTokens', 'medianOutputTokensPerSecond',
    'medianTimeToFirstTokenSeconds', 'contextWindowTokens', 'releaseDate',
  ],
}

/**
 * Coerce arbitrary input — a hand-edited file, a request body, an export from an older
 * build, a localStorage entry — into a usable {@link View}.
 *
 * Deliberately total: it never throws. Anything unrecognised falls back to its default
 * rather than rejecting the whole file, so one bad column name cannot cost you the rest
 * of a carefully built view.
 *
 * Free of cordis and Node built-ins so it can be bundled into the static build.
 */
export function normalizeView(input: unknown): View {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>

  return {
    version: VIEW_VERSION,
    filter: typeof source.filter === 'string' ? source.filter.slice(0, MAX_FILTER_LENGTH) : DEFAULT_VIEW.filter,
    sort: typeof source.sort === 'string' ? findField(source.sort)?.name ?? DEFAULT_VIEW.sort : DEFAULT_VIEW.sort,
    order: source.order === 'asc' || source.order === 'desc' ? source.order : DEFAULT_VIEW.order,
    columns: normalizeColumns(source.columns),
  }
}

function normalizeColumns(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_VIEW.columns]
  const names = input
    .filter((name): name is string => typeof name === 'string')
    .map((name) => findField(name)?.name)
    .filter((name): name is string => name !== undefined)
  const unique = [...new Set(names)]
  // An empty or entirely unrecognised list is more likely a mistake than intent.
  return unique.length > 0 ? unique : [...DEFAULT_VIEW.columns]
}
