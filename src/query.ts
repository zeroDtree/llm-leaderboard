import { Service, type Context } from 'cordis'
import { compileFilter, FilterError } from './filter.js'
import { FIELDS, fieldAccessors, suggestField, type Accessor, type FieldDef } from './fields.js'
import { runQuery, type QueryOptions, type QueryResult } from './query-core.js'
import type { ModelRecord } from './types.js'

export type { QueryOptions, QueryResult } from './query-core.js'

declare module 'cordis' {
  interface Context {
    query: Query
  }
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
    return runQuery(models, options)
  }
}
