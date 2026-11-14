import { Service, type Context } from 'cordis'
import Schema from 'schemastery'
import type { ModelRecord, Snapshot } from './types.js'

declare module 'cordis' {
  interface Context {
    aa: ArtificialAnalysis
  }
}

export const LEADERBOARD_URL = 'https://artificialanalysis.ai/leaderboards/models'

/**
 * Artificial Analysis requires attribution, and a scraper should be identifiable.
 * Nothing here is authenticated — the page is public and `robots.txt` allows it.
 */
const USER_AGENT = 'llm-leaderboard/0.1 (personal, local use)'

/**
 * Below this, the page almost certainly changed shape and we are misreading it.
 * Failing loudly beats silently caching an empty leaderboard.
 */
const MIN_PLAUSIBLE_MODELS = 100

/**
 * Full records carry dozens of fields; the release-mapping records that sit under a
 * nearby `models` key carry three or four. Rejecting the narrow ones here is what keeps
 * a page reshuffle from silently caching names with every statistic missing.
 */
const MIN_RECORD_FIELDS = 10

// ---------------------------------------------------------------------------
// Page parsing
//
// The leaderboard ships as a Next.js App Router page: there is no `__NEXT_DATA__`
// and no JSON endpoint behind it. Instead React streams "flight" chunks —
//
//   self.__next_f.push([1,"<json-escaped string>"])
//
// whose concatenation is a second JSON document. The page itself inlines only the
// models in its default view (`initialModels`) and points at an encrypted, gzipped
// dataset (`manifest`) for the complete leaderboard; both are read here. The
// functions below are deliberately pure so they can be tested against a saved
// page without touching the network, and they key off structure (the record with
// the most fields) rather than a hardcoded byte offset, so a page rebuild that
// shuffles chunk boundaries does not break them.
//
// Since late 2026 the payload no longer publishes the flat record shape snapshots
// use: the model's slug is nested under `release`, benchmarks live in a `scores`
// map keyed by benchmark slug, and the performance block is renamed. The parser
// translates both that shape and the older flat one back into the stable
// `ModelRecord` shape, so saved views and filter expressions keep working.
// ---------------------------------------------------------------------------

const FLIGHT_PUSH = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g

/** Decode the streamed flight chunks back into one string. */
export function flightPayload(html: string): string {
  return Array.from(html.matchAll(FLIGHT_PUSH), (match) => JSON.parse(`"${match[1]!}"`) as string).join('')
}

/**
 * Index just past the JSON value starting at `start`, skipping brackets that appear
 * inside string literals.
 */
export function scanValue(source: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const char = source[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error('unbalanced JSON in page payload — the page format probably changed')
}

/** Every JSON value following `key` in `source`, ignoring anything that does not parse. */
function findAfter<T>(source: string, key: string, open: '{' | '['): T[] {
  const found: T[] = []
  let from = 0
  for (;;) {
    const at = source.indexOf(key, from)
    if (at === -1) return found
    from = at + key.length
    const start = source.indexOf(open, at + key.length - 1)
    if (start === -1) continue
    try {
      found.push(JSON.parse(source.slice(start, scanValue(source, start))) as T)
    } catch {
      // Not a well-formed JSON value at this occurrence; keep scanning.
    }
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The leaderboard records are the widest objects in the payload — 50-odd fields,
 * against three or four for the release-mapping records that share the `models` key.
 * Picking the widest candidate is what keeps this correct without a hardcoded chunk offset.
 */
function widestArrayOf(candidates: unknown[][], shape: (row: Record<string, unknown>) => boolean): unknown[][] {
  return candidates
    .filter((rows) => rows.length > 0 && rows.every((row) => isObject(row) && shape(row)))
    .sort((a, b) => fieldCount(b) - fieldCount(a))
}

function fieldCount(rows: unknown[]): number {
  const first = rows[0]
  return isObject(first) ? Object.keys(first).length : 0
}

/** A leaderboard row rather than a release mapping: it has a slug and real content. */
function isModelRow(row: Record<string, unknown>): boolean {
  const slug = typeof row.slug === 'string'
    ? row.slug
    // Current payload: the slug lives on the nested `release` object.
    : isObject(row.release) && typeof row.release.slug === 'string' ? row.release.slug : undefined
  return slug !== undefined && Object.keys(row).length >= MIN_RECORD_FIELDS
}

// ---------------------------------------------------------------------------
// Payload -> ModelRecord translation
//
// The current page publishes records as
//
//   { release: { slug }, name, ..., scores: { 'gpqa-diamond': 0.87 }, outputSpeed }
//
// while snapshots have always used flat names (`slug`, `gpqa`, `medianOutputTokensPerSecond`).
// Translating rather than renaming keeps every saved filter and view valid; the payload's
// own names are registered as aliases in `fields.ts`, so both spellings work.
// ---------------------------------------------------------------------------

/** Benchmark slugs in `scores`, mapped to the flat snapshot field names. */
const SCORE_FIELDS: Readonly<Record<string, string>> = {
  'humanitys-last-exam': 'hle',
  'hle-diamond': 'hleDiamond',
  'gpqa-diamond': 'gpqa',
  'critpt': 'critpt',
  'critpt-v2-hard': 'critptV2Hard',
  'artificial-analysis-long-context-reasoning': 'lcr',
  'mlcr-aa': 'multilingualLcr',
  'ifbench': 'ifbench',
  'tau2-bench': 'tau2',
  'tau3-banking': 'tauBanking',
  'terminalbench-hard': 'terminalbenchHard',
  'terminalbench-2-1': 'terminalBench21',
  'terminalbench-4-0': 'terminalBench40',
  'terminal-bench-science': 'terminalBenchScience',
  'livecodebench': 'livecodebench',
  'aime-2025': 'aime2025',
  'gdpval-aa-normalized': 'gdpvalNormalized',
  'gdp-pdf': 'gdpPdf',
  'mmmu-pro': 'mmmuPro',
  'scicode': 'scicode',
  'aa-briefcase': 'aaBriefcase',
  'automationbench-aa': 'automationBench',
  'omniscience-accuracy': 'omniscienceAccuracy',
  'omniscience-non-hallucination': 'omniscienceNonHallucination',
  'frontiercode': 'frontierCode',
  'frontiercode-2-0': 'frontierCode20',
  'aa-analyst-agent': 'analystAgent',
  'enterprise-ops-gym-aa': 'enterpriseOpsGym',
  'itbench-aa': 'itbenchSre',
  'apex-agents-aa': 'apexAgents',
  'harvey-lab-aa': 'harveyLab',
  'code2video-aa': 'code2Video',
  'aa-3d': 'aa3d',
  'mka': 'mka',
  'vials-aa': 'vials',
  'healthbench': 'healthbench',
  'healthbench-professional': 'healthbenchProfessional',
}

/** Performance fields renamed by the new payload; the snapshot names stay put. */
const RENAMED_FIELDS: Readonly<Record<string, string>> = {
  outputSpeed: 'medianOutputTokensPerSecond',
  timeToFirstToken: 'medianTimeToFirstTokenSeconds',
  timeToFirstAnswerToken: 'medianTimeToFirstAnswerTokenSeconds',
}

/** Top-level fields the new payload publishes under the same name. */
const COPIED_FIELDS = [
  'name', 'shortName', 'deprecated', 'isReasoning', 'isOpenWeights', 'paramClass', 'priceClass',
  'modelCreatorName', 'modelCreatorColor', 'modelCreatorLogo', 'contextWindowTokens',
  'intelligenceIndex', 'omniscience', 'price1mInputTokens', 'price1mOutputTokens',
  'cacheHitPrice', 'cacheWritePrice', 'intelligenceIndexCostPerTask', 'intelligenceIndexTimePerTask',
] as const

/**
 * Translate one payload record into a snapshot record.
 *
 * Records cached from the older flat payload are returned as they are. The new shape
 * is flattened by copy, leaving absent fields absent rather than writing `undefined`,
 * which preserves the null-vs-missing distinction the filters rely on.
 */
function normalizeRecord(row: Record<string, unknown>): ModelRecord {
  if (typeof row.slug === 'string') return { ...row } as unknown as ModelRecord

  const release = isObject(row.release) ? row.release : undefined
  const slug = release && typeof release.slug === 'string' ? release.slug : undefined
  if (!slug) throw new Error('model record has no slug — the page format probably changed')

  const out: Record<string, unknown> = { slug }
  for (const key of COPIED_FIELDS) {
    if (key in row) out[key] = row[key]
  }
  for (const [from, to] of Object.entries(RENAMED_FIELDS)) {
    if (from in row) out[to] = row[from]
  }
  if (isObject(row.scores)) {
    for (const [from, to] of Object.entries(SCORE_FIELDS)) {
      if (from in row.scores) out[to] = row.scores[from]
    }
  }
  return out as unknown as ModelRecord
}

/** The encrypted dataset the page's client fetches to show models outside the default view. */
export interface Manifest {
  /** Same-origin path to the encrypted, gzipped JSON array. */
  path: string
  /** Hex AES-GCM key; the IV is the first 12 bytes of its SHA-256 digest. */
  key: string
}

export interface LeaderboardPage {
  /** Records rendered into the page itself — the current, non-deprecated models. */
  models: ModelRecord[]
  /** Slug -> release date, used to decorate whichever record set wins. */
  releaseDates: Map<string, string>
  /** Present on pages that publish the complete dataset as a separate fetch. */
  manifest?: Manifest
}

function withReleaseDates(models: ModelRecord[], releaseDates: Map<string, string>): ModelRecord[] {
  return models.map((model) => (
    releaseDates.has(model.slug) ? { ...model, releaseDate: releaseDates.get(model.slug) } : { ...model }
  ))
}

/**
 * Pull everything the page offers: the inline model records, release metadata, and the
 * manifest of the complete dataset.
 *
 * The page used to inline every record under `models`. It now inlines only the models in
 * the default view under `initialModels` and publishes the rest — mostly deprecated
 * models — through the encrypted manifest, so the inline records alone are incomplete.
 */
export function parsePage(html: string): LeaderboardPage {
  const payload = flightPayload(html)
  const releaseDates = parseReleaseDates(payload)

  const candidates = [
    ...findAfter<unknown[]>(payload, '"initialModels":[', '['),
    // Older pages inlined the full set under `models`; kept as a fallback.
    ...findAfter<unknown[]>(payload, '"models":[', '['),
  ]
  const [best] = widestArrayOf(candidates, isModelRow)
  if (!best) throw new Error('no model records found in page payload — the page format probably changed')

  const models = (best as Record<string, unknown>[]).map(normalizeRecord)
  return {
    models: withReleaseDates(models, releaseDates),
    releaseDates,
    manifest: parseManifest(payload),
  }
}

/**
 * Pull the model records out of a leaderboard page and attach release dates.
 *
 * Release metadata lives in a separate `modelsAndReleases` structure keyed by a
 * different slug, so it has to be joined in.
 */
export function parseLeaderboard(html: string): ModelRecord[] {
  return parsePage(html).models
}

/** Find the encrypted-dataset manifest, if the page publishes one. */
export function parseManifest(payload: string): Manifest | undefined {
  for (const value of findAfter<Record<string, unknown>>(payload, '"manifest":', '{')) {
    if (typeof value.path === 'string' && typeof value.key === 'string') {
      return { path: value.path, key: value.key }
    }
  }
  return undefined
}

/**
 * Decrypt and decompress a manifest dataset.
 *
 * The page's client derives an AES-GCM IV from the key itself (the first 12 bytes of the
 * SHA-256 digest of the raw key bytes) and gzips the JSON before encrypting. Mirroring
 * that here lets a refresh see the same complete dataset the site loads.
 */
export async function decodeManifest(encrypted: ArrayBuffer, keyHex: string): Promise<unknown> {
  if (keyHex.length === 0 || keyHex.length % 2 !== 0 || /[^0-9a-f]/i.test(keyHex)) {
    throw new Error('malformed manifest key')
  }
  const raw = new Uint8Array(keyHex.length / 2)
  for (let i = 0; i < raw.length; i++) {
    raw[i] = Number.parseInt(keyHex.slice(i * 2, i * 2 + 2), 16)
  }
  const iv = new Uint8Array(await crypto.subtle.digest('SHA-256', raw)).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encrypted)
  const json = await new Response(
    new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text()
  return JSON.parse(json)
}

/**
 * Map leaderboard slug -> ISO release date.
 *
 * The current page publishes a top-level `releases` array whose slugs the records
 * reference through `release.slug`, so the join is direct. The previous payload nested
 * the same release records inside `modelsAndReleases`, but went through a separate
 * `releaseSlug` mapping; that indirection is still handled so an old saved page parses.
 */
function parseReleaseDates(payload: string): Map<string, string> {
  const dates = new Map<string, string>()

  for (const array of findAfter<unknown[]>(payload, '"releases":[', '[')) {
    for (const release of array) {
      if (isObject(release) && typeof release.slug === 'string' && typeof release.releaseDate === 'string') {
        dates.set(release.slug, release.releaseDate)
      }
    }
  }

  // Legacy: model slug -> releaseSlug -> date.
  const container = findAfter<Record<string, unknown>>(payload, '"modelsAndReleases":', '{')
    .sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0]
  const models = container && Array.isArray(container.models) ? container.models : []
  for (const model of models) {
    if (!isObject(model) || typeof model.slug !== 'string' || typeof model.releaseSlug !== 'string') continue
    const date = dates.get(model.releaseSlug)
    if (date) dates.set(model.slug, date)
  }
  return dates
}

// ---------------------------------------------------------------------------

export class ArtificialAnalysis extends Service {
  static Config = Schema.object({
    url: Schema.string().default(LEADERBOARD_URL).description('Leaderboard page to scrape.'),
    timeout: Schema.number().default(30_000).description('Request timeout in milliseconds.'),
  })

  static inject = ['store']

  private readonly config: { url: string; timeout: number }
  private models: ModelRecord[] = []
  private fetchedAt: string | null = null

  constructor(ctx: Context, config: { url: string; timeout: number }) {
    super(ctx, 'aa')
    this.config = config
  }

  /** Warm from the last snapshot so the viewer works without a network call. */
  async *[Service.init](): AsyncGenerator<() => void> {
    const cached = await this.ctx.store.read()
    if (!cached) return
    this.models = cached.models
    this.fetchedAt = cached.fetchedAt
    this.ctx.logger('aa').info('restored', cached.models.length, 'models from cache')
  }

  get snapshot(): Snapshot {
    return { fetchedAt: this.fetchedAt ?? new Date(0).toISOString(), source: this.config.url, models: this.models }
  }

  get isLoaded(): boolean {
    return this.models.length > 0
  }

  list(): readonly ModelRecord[] {
    return this.models
  }

  /** Fetch the page, parse it, and persist. Throws if the page stops parsing. */
  async refresh(): Promise<Snapshot> {
    const logger = this.ctx.logger('aa')
    logger.info('fetching', this.config.url)

    const response = await fetch(this.config.url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${this.config.url}`)

    const page = parsePage(await response.text())
    let models = page.models

    if (page.manifest) {
      try {
        const complete = await this.fetchManifest(page.manifest)
        if (complete.length >= MIN_PLAUSIBLE_MODELS) {
          models = withReleaseDates(complete, page.releaseDates)
        } else {
          logger.warn(`manifest held only ${complete.length} models; keeping the page's ${models.length}`)
        }
      } catch (error) {
        // A failed manifest fetch should not discard a usable page; the next refresh retries.
        logger.warn('could not load the complete dataset; using the page records:', error)
      }
    }

    if (models.length < MIN_PLAUSIBLE_MODELS) {
      throw new Error(
        `parsed only ${models.length} models (expected at least ${MIN_PLAUSIBLE_MODELS}); ` +
        'the leaderboard page likely changed format — not overwriting the cached snapshot',
      )
    }

    const snapshot: Snapshot = {
      fetchedAt: new Date().toISOString(),
      source: this.config.url,
      models,
    }
    const path = await this.ctx.store.write(snapshot)
    this.models = models
    this.fetchedAt = snapshot.fetchedAt
    logger.info('wrote', models.length, 'models to', path)
    return snapshot
  }

  /** Fetch and decode the encrypted dataset linked from the page. */
  private async fetchManifest(manifest: Manifest): Promise<ModelRecord[]> {
    const url = new URL(manifest.path, this.config.url)
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/octet-stream, */*' },
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`)

    const data = await decodeManifest(await response.arrayBuffer(), manifest.key)
    if (!Array.isArray(data) || data.length === 0) throw new Error('manifest dataset is not a non-empty array')
    if (!data.every((row) => isObject(row) && isModelRow(row))) {
      throw new Error('manifest dataset does not contain model records')
    }
    return (data as Record<string, unknown>[]).map(normalizeRecord)
  }

  /** Load from cache if nothing is in memory yet. Used when serving without a refresh. */
  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return
    if (!(await this.ctx.store.read())) await this.refresh()
  }
}
