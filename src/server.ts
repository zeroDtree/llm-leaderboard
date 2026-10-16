import { Service, type Context } from 'cordis'
import Schema from 'schemastery'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { FilterError } from './filter.js'
import { coverage, FIELDS, materialize } from './fields.js'
import type { ModelRecord } from './types.js'

declare module 'cordis' {
  interface Context {
    server: ViewerServer
  }
}

const INDEX_HTML = new URL('../public/index.html', import.meta.url)

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function numberParam(value: string | null): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** Serves the viewer UI and the JSON API over it. */
export class ViewerServer extends Service {
  static Config = Schema.object({
    // Loopback by default: this exposes a local cache, not a public service.
    host: Schema.string().default('127.0.0.1'),
    port: Schema.number().default(3000).description('Use 0 for an ephemeral port.'),
  })

  static inject = ['aa', 'query']

  private readonly config: { host: string; port: number }
  private address = ''

  constructor(ctx: Context, config: { host: string; port: number }) {
    super(ctx, 'server')
    this.config = config
  }

  /** The URL the server is actually listening on, once started. */
  get url(): string {
    return this.address
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void>> {
    const http: Server = createServer((request, response) => {
      this.route(request, response).catch((error: unknown) => {
        this.ctx.logger('server').warn('request failed:', error)
        if (!response.headersSent) json(response, 500, { error: 'internal error' })
      })
    })

    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(this.config.port, this.config.host, resolve)
    })

    const bound = http.address()
    const port = typeof bound === 'object' && bound ? bound.port : this.config.port
    this.address = `http://${this.config.host}:${port}`
    this.ctx.logger('server').info('listening on', this.address)

    yield () => new Promise<void>((resolve) => http.close(() => resolve()))
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (path === '/' || path === '/index.html') return this.serveIndex(response)
    if (path === '/favicon.ico') { response.writeHead(204).end(); return }
    if (path === '/api/models') return this.serveModels(url.searchParams, response)
    if (path === '/api/fields') return this.serveFields(response)
    if (path === '/api/refresh' && request.method === 'POST') return this.serveRefresh(response)

    json(response, 404, { error: `no route for ${path}` })
  }

  private async serveIndex(response: ServerResponse): Promise<void> {
    try {
      // Read per request so editing the UI does not need a restart.
      const html = await readFile(INDEX_HTML, 'utf8')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(html)
    } catch {
      json(response, 500, { error: 'public/index.html is missing' })
    }
  }

  private serveModels(params: URLSearchParams, response: ServerResponse): void {
    try {
      const result = this.ctx.query.run(this.ctx.aa.list(), {
        filter: params.get('filter') ?? undefined,
        sort: params.get('sort') ?? undefined,
        order: params.get('order') === 'asc' ? 'asc' : undefined,
        limit: numberParam(params.get('limit')),
        offset: numberParam(params.get('offset')),
      })
      json(response, 200, {
        ...result,
        models: result.models.map(materialize),
        fetchedAt: this.ctx.aa.snapshot.fetchedAt,
        source: this.ctx.aa.snapshot.source,
      })
    } catch (error) {
      if (error instanceof FilterError) return json(response, 400, { error: error.message, pos: error.pos })
      throw error
    }
  }

  private serveFields(response: ServerResponse): void {
    const models: readonly ModelRecord[] = this.ctx.aa.list()
    const counts = coverage([...models])
    json(response, 200, {
      fields: FIELDS.map((field) => ({
        name: field.name,
        label: field.label,
        format: field.format,
        aliases: field.aliases,
        derived: field.derived ?? false,
        coverage: counts[field.name] ?? 0,
      })),
      total: models.length,
    })
  }

  private async serveRefresh(response: ServerResponse): Promise<void> {
    try {
      const snapshot = await this.ctx.aa.refresh()
      json(response, 200, { ok: true, models: snapshot.models.length, fetchedAt: snapshot.fetchedAt })
    } catch (error) {
      json(response, 502, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
