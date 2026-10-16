#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { Context, type Exporter } from 'cordis'
import { ArtificialAnalysis, LEADERBOARD_URL } from './aa.js'
import { FIELDS, fieldByName, formatValue } from './fields.js'
import { FilterError } from './filter.js'
import { Query } from './query.js'
import { ViewerServer } from './server.js'
import { Store } from './store.js'
import type { ModelRecord } from './types.js'

const DEFAULT_CACHE_DIR = '.cache'
const DEFAULT_PORT = 3000
const REQUEST_TIMEOUT = 30_000

const USAGE = `
  llm-leaderboard — scrape and browse the Artificial Analysis LLM leaderboard locally

  Usage
    llm-leaderboard refresh [--cache <dir>]
    llm-leaderboard serve   [--cache <dir>] [--port <n>] [--host <addr>]
    llm-leaderboard filter <expression> [--sort <field>] [--order asc|desc]
                                        [--limit <n>] [--offset <n>] [--json | --csv]
    llm-leaderboard fields  [--search <text>]

  Examples
    llm-leaderboard filter 'price < 1'
    llm-leaderboard filter 'price < 1 and intelligence > 40 and not deprecated' --sort price --order asc
    llm-leaderboard filter 'creator in (Anthropic, OpenAI)' --limit 20
    llm-leaderboard filter 'name ~ claude or context >= 1000000'

  Filter expression
    Comparisons   <  <=  >  >=  ==  =  !=        price < 1
    Contains      ~   !~                          name ~ claude
    Set membership  in (a, b, c)                  creator in (Anthropic, OpenAI)
    Logic         and &&  or ||  not !            price < 1 and not deprecated
    Grouping      ( … )                           (price < 0.5 or price > 100) and openWeights

    A bare field name asserts it has a value, so 'not deprecated' works as written.
    Unknown or missing values never satisfy an ordering comparison, so 'price < 1'
    excludes models with no published price rather than treating them as free.

  Run 'llm-leaderboard fields' to list all filterable field names.
`.trimStart()

/**
 * Minimal console sink for cordis's structured logger.
 *
 * Everything goes to stderr: stdout carries only command output, so `--json` and
 * `--csv` stay pipeable into other tools.
 */
function consoleExporter(): Exporter {
  return {
    export(message) {
      process.stderr.write(`${message.type.toUpperCase().padEnd(5)} ${message.name}  ${message.args.join(' ')}\n`)
    },
  }
}

interface AppOptions {
  cache: string
}

/** Assemble the cordis application. Services are independent plugins; this is the only place they are wired together. */
async function createApp(options: AppOptions): Promise<Context> {
  const ctx = new Context()
  ctx.logger.exporter(consoleExporter())

  await ctx.plugin(Store, { dir: options.cache })
  await ctx.plugin(ArtificialAnalysis, { url: LEADERBOARD_URL, timeout: REQUEST_TIMEOUT })
  await ctx.plugin(Query)

  return ctx
}

async function loadApp(options: AppOptions): Promise<Context> {
  const ctx = await createApp(options)
  await ctx.aa.ensureLoaded()
  return ctx
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

function reportFilterError(error: unknown): never {
  if (error instanceof FilterError) {
    const caret = error.pos == null ? '' : `\n  ${' '.repeat(error.pos)}^`
    fail(`${error.message}${caret}`)
  }
  throw error
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const SUMMARY_COLUMNS = ['name', 'modelCreatorName', 'intelligenceIndex', 'price', 'medianOutputTokensPerSecond', 'contextWindowTokens', 'releaseDate']

function renderTable(models: ModelRecord[]): string {
  const fields = SUMMARY_COLUMNS.map(fieldByName)
  const rows = models.map((model) => fields.map((field) => formatValue(field, field.get(model))))

  const widths = fields.map((field, column) =>
    Math.max(field.label.length, ...rows.map((row) => (row[column] ?? '').length)))

  const line = (cells: string[]) =>
    cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd()

  return [
    line(fields.map((f) => f.label)),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n')
}

function toCsv(models: ModelRecord[]): string {
  const columns = FIELDS.filter((f) => !f.name.endsWith('Logo') && !f.name.endsWith('Color'))
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
  return [
    columns.map((f) => f.name).join(','),
    ...models.map((model) => columns.map((f) => escape(formatValue(f, f.get(model)))).join(',')),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandRefresh(options: AppOptions): Promise<void> {
  const ctx = await createApp(options)
  const snapshot = await ctx.aa.refresh()
  process.stdout.write(`\n${snapshot.models.length} models — ${snapshot.fetchedAt}\n`)
}

async function commandServe(options: AppOptions, host: string, port: number): Promise<void> {
  const ctx = await loadApp(options)
  await ctx.plugin(ViewerServer, { host, port })

  const url = ctx.get('server')?.url ?? `http://${host}:${port}`
  const models = ctx.aa.list()
  process.stdout.write(
    `\n  ${url}\n  ${models.length} models, scraped ${ctx.aa.snapshot.fetchedAt}\n` +
    `  Filter with expressions like: price < 1 and intelligence > 40\n\n`,
  )
  // The listening socket keeps the process alive until interrupted.
}

interface FilterFlags {
  sort: string
  order: 'asc' | 'desc'
  limit?: number
  offset?: number
  json: boolean
  csv: boolean
}

function commandFilter(ctx: Context, expression: string, flags: FilterFlags): void {
  const result = ctx.query.run(ctx.aa.list(), {
    filter: expression,
    sort: flags.sort,
    order: flags.order,
    limit: flags.limit,
    offset: flags.offset,
  })

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result.models, null, 2)}\n`)
    return
  }
  if (flags.csv) {
    process.stdout.write(`${toCsv(result.models)}\n`)
    return
  }

  const scope = result.matched === result.total
    ? `${result.total} models`
    : `${result.matched} of ${result.total} models`
  process.stdout.write(`\n${renderTable(result.models)}\n\n${scope}`)
  if (result.models.length < result.matched) {
    process.stdout.write(`  (showing ${result.models.length})`)
  }
  process.stdout.write('\n')
}

async function commandFields(search: string | undefined): Promise<void> {
  const direction = search ? ` matching "${search}"` : ''
  const fields = FIELDS.filter((field) => {
    if (!search) return true
    const needle = search.toLowerCase()
    return field.name.toLowerCase().includes(needle)
      || field.label.toLowerCase().includes(needle)
      || field.aliases.some((alias) => alias.includes(needle))
  })

  const lines = fields.map((field) => {
    const aliases = field.aliases.length ? `  aliases: ${field.aliases.join(', ')}` : ''
    const derived = field.derived ? ' (derived)' : ''
    return `  ${field.name.padEnd(34)} ${field.format.padEnd(8)} ${field.label}${derived}${aliases}`
  })

  process.stdout.write(`\n${fields.length} fields${direction}:\n\n${lines.join('\n')}\n`)
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      cache: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      sort: { type: 'string', short: 's' },
      order: { type: 'string' },
      limit: { type: 'string', short: 'n' },
      offset: { type: 'string' },
      search: { type: 'string' },
      json: { type: 'boolean' },
      csv: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  const command = positionals[0]

  if (values.help || !command) {
    process.stdout.write(USAGE)
    process.exit(values.help ? 0 : 1)
  }

  const options: AppOptions = { cache: values.cache ?? DEFAULT_CACHE_DIR }
  const order = values.order === 'asc' || values.order === 'desc'
    ? values.order
    : values.order == null ? 'desc' : fail(`--order must be "asc" or "desc", got "${values.order}"`)

  switch (command) {
    case 'refresh':
      return commandRefresh(options)

    case 'serve':
      return commandServe(options, values.host ?? '127.0.0.1', values.port ? Number(values.port) : DEFAULT_PORT)

    case 'filter': {
      // An expression given but empty means "match everything"; omitting it is a usage error.
      if (positionals.length < 2) fail('filter needs an expression, e.g. llm-leaderboard filter \'price < 1\'')
      const expression = positionals.slice(1).join(' ')
      if (values.json && values.csv) fail('--json and --csv are mutually exclusive')

      try {
        const ctx = await loadApp(options)
        commandFilter(ctx, expression, {
          sort: values.sort ?? 'intelligence',
          order,
          limit: values.limit ? Number(values.limit) : undefined,
          offset: values.offset ? Number(values.offset) : undefined,
          json: values.json ?? false,
          csv: values.csv ?? false,
        })
      } catch (error) {
        reportFilterError(error)
      }
      return
    }

    case 'fields':
      return commandFields(values.search)

    default:
      fail(`unknown command "${command}" — expected refresh, serve, filter, or fields`)
  }
}

main().catch((error: unknown) => {
  if (error instanceof FilterError) reportFilterError(error)
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
