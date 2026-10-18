import { Service, type Context } from 'cordis'
import { compileFilter, FilterError } from './filter.js'
import { FIELDS, fieldAccessors, suggestField, type Accessor, type FieldDef } from './fields.js'
import type { ModelRecord } from './types.js'

declare module 'cordis' {
  interface Context {
    query: Query
  }
}

export interface QueryOptions {
  /** Filter expression; empty or omitted matches everything. */
  filter?: string
  /** Canonical field name or alias to sort by. */
  sort?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface QueryResult {
  models: ModelRecord[]
  /** Rows after filtering. */
  matched: number
  /** Rows before filtering. */
  total: number
  /** The sort actually applied, after defaulting. */
  sort: string
  order: 'asc' | 'desc'
}

const isMissing = (value: unknown): boolean => value === null || value === undefined || value === ''

/**
 * Order two present values. Missing values are handled by the caller so that their
 * placement can be kept independent of the sort direction.
 */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b))
}

export class Query extends Service {
  private readonly accessors: Record<string, Accessor> = fieldAccessors()

  constructor(ctx: Context) {
    super(ctx, 'query')
  }

  /** Compile a filter expression to a predicate. @throws {FilterError} */
  compile(filter: string): (model: ModelRecord) => boolean {
    return compileFilter(filter, this.accessors, { suggest: suggestField })
  }

  /** Resolve a field name or alias. @throws {FilterError} */
  field(name: string): FieldDef {
    const found = FIELDS.find((f) => f.name.toLowerCase() === name.toLowerCase())
      ?? FIELDS.find((f) => f.aliases.includes(name.toLowerCase()))
    if (!found) {
      const hint = suggestField(name)
      throw new FilterError(`unknown field "${name}"${hint ? ` — did you mean "${hint}"?` : ''}`)
    }
    return found
  }

  /** Filter, sort, and page a set of models. */
  run(models: readonly ModelRecord[], options: QueryOptions = {}): QueryResult {
    const predicate = this.compile(options.filter ?? '')
    const rows = models.filter(predicate)

    const sort = options.sort ?? 'intelligence'
    const order = options.order ?? 'desc'
    const accessor = this.accessors[sort.toLowerCase()]
    if (!accessor) throw new FilterError(`unknown field "${sort}"`)

    const sorted = [...rows].sort((a, b) => {
      const aValue = accessor(a)
      const bValue = accessor(b)
      const aMissing = isMissing(aValue)
      const bMissing = isMissing(bValue)
      // Missing data stays at the end in both directions — negating the comparison for
      // `desc` must not also flip where the rows without a value land.
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      const result = aMissing ? 0 : compareValues(aValue, bValue)
      // Stable, meaningful tie-break so equal scores have a deterministic order.
      return result !== 0 ? (order === 'desc' ? -result : result) : compareValues(a.name, b.name)
    })

    const offset = Math.max(0, options.offset ?? 0)
    const limit = options.limit == null ? undefined : Math.max(0, options.limit)

    return {
      models: limit == null ? sorted.slice(offset) : sorted.slice(offset, offset + limit),
      matched: sorted.length,
      total: models.length,
      sort,
      order,
    }
  }
}
