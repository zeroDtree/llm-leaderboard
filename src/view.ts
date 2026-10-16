import { Service, type Context } from 'cordis'
import Schema from 'schemastery'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { findField } from './fields.js'

declare module 'cordis' {
  interface Context {
    view: ViewService
  }
}

/**
 * A saved viewing configuration: what you are looking at, not what the data says.
 *
 * Persisted as plain JSON at a known path so it survives a restart, can be opened in an
 * editor, kept in version control, or handed to someone else.
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
 * build — into a usable {@link View}.
 *
 * Deliberately total: it never throws. Anything unrecognised falls back to its default
 * rather than rejecting the whole file, so one bad column name cannot cost you the rest
 * of a carefully built view.
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

/** Reads and writes the saved view. */
export class ViewService extends Service {
  static Config = Schema.object({
    file: Schema.string().default('view.json').description('Where the saved view is kept.'),
  })

  private readonly path: string
  private current: View = { ...DEFAULT_VIEW, columns: [...DEFAULT_VIEW.columns] }

  constructor(ctx: Context, config: { file: string }) {
    super(ctx, 'view')
    this.path = resolve(config.file)
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const stored = await this.read()
    if (stored) this.current = stored
  }

  /** The current view. Always valid, even before anything has been saved. */
  get(): View {
    return this.current
  }

  /** Replace the view, writing it to disk. Accepts anything; returns what was stored. */
  async save(input: unknown): Promise<View> {
    this.current = normalizeView(input)
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8')
    return this.current
  }

  private async read(): Promise<View | null> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if ((parsed as View)?.version !== VIEW_VERSION) {
        this.ctx.logger('view').warn('reading a view of a different version; unknown parts will use defaults')
      }
      return normalizeView(parsed)
    } catch (error) {
      // A corrupt or half-written file must not stop the app from starting.
      this.ctx.logger('view').warn('ignoring unreadable', this.path, '-', (error as Error).message)
      return null
    }
  }
}
