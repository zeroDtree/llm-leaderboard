import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeManifest, flightPayload, parseLeaderboard, parsePage, scanValue, type Manifest } from './aa.js'

/**
 * Build a page that mimics the current payload: a wide record array under
 * `initialModels` (slug nested under `release`, benchmarks under `scores`) and a
 * top-level `releases` array carrying the dates.
 */
function fakePage(
  models: unknown[],
  releases: unknown[] = [],
  key = 'initialModels',
  manifest?: Manifest,
): string {
  const payload = [
    `21:["$","div",null,{"className":"container","children":[["$","$L22",null,{"${key}":`,
    JSON.stringify(models),
    '}]]}',
    'd:{"releases":',
    JSON.stringify(releases),
    '}',
    manifest ? `e:{"manifest":${JSON.stringify(manifest)}}` : '',
  ].join('')
  // The real page streams this as a JSON-escaped string argument.
  return `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`
}

/**
 * Build a page in the older shape: flat records under `models`, release metadata
 * nested in `modelsAndReleases`, joined through the `releaseSlug` indirection.
 */
function legacyPage(
  models: unknown[],
  releases: unknown[] = [],
  mappings: unknown[] = [],
  key = 'models',
): string {
  const payload = [
    `21:["$","div",null,{"className":"container","children":[["$","$L22",null,{"${key}":`,
    JSON.stringify(models),
    '}]]}',
    'd:{"modelsAndReleases":',
    JSON.stringify({ releases, models: mappings }),
    '}',
  ].join('')
  return `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`
}

/** A record in the current payload shape, with every field the parser reads. */
function published(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    release: { slug },
    name: `Model ${slug}`,
    shortName: slug,
    deprecated: false,
    isReasoning: false,
    isOpenWeights: true,
    paramClass: 'large',
    priceClass: 'medium',
    modelCreatorName: 'Acme',
    modelCreatorColor: '#000',
    modelCreatorLogo: '/logo.svg',
    contextWindowTokens: 1000,
    intelligenceIndex: 42.5,
    omniscience: null,
    scores: { 'humanitys-last-exam': 0.9, 'gpqa-diamond': 0.8, 'terminalbench-hard': 0.4 },
    price1mInputTokens: 1,
    price1mOutputTokens: 2,
    cacheHitPrice: null,
    cacheWritePrice: null,
    intelligenceIndexCostPerTask: 0.5,
    intelligenceIndexTimePerTask: 60,
    ...overrides,
  }
}

/** A record in the older flat shape. */
const legacyWide = [
  { slug: 'model-a', name: 'Model A', deprecated: false, isReasoning: false, modelCreatorName: 'A', intelligenceIndex: 42.5, contextWindowTokens: 1000, isOpenWeights: true, price1mInputTokens: 1, price1mOutputTokens: 2 },
  { slug: 'model-b', name: 'Model B', deprecated: false, isReasoning: false, modelCreatorName: 'B', intelligenceIndex: 11, contextWindowTokens: 2000, isOpenWeights: false, price1mInputTokens: null, price1mOutputTokens: null },
]
// Seven fields shorter than `legacyWide` — the parser must not pick this one.
const narrow = [{ slug: 'model-a', name: 'Model A', releaseSlug: 'rel-a' }]

test('decodes concatenated flight chunks', () => {
  const page = '<script>self.__next_f.push([1,"abc"])</script><script>self.__next_f.push([1,"def"])</script>'
  assert.equal(flightPayload(page), 'abcdef')
})

test('scanValue is string-aware', () => {
  const source = '[1, {"k": "] } ["}, 2]'
  assert.equal(scanValue(source, 0), source.length)
})

test('flattens the current payload into the snapshot record shape', () => {
  const [model] = parseLeaderboard(fakePage([published('model-a')]))
  assert.equal(model!.slug, 'model-a')
  assert.equal(model!.name, 'Model model-a')
  // `scores` entries are renamed to the fields the app has always exposed.
  assert.equal(model!.hle, 0.9)
  assert.equal(model!.gpqa, 0.8)
  assert.equal(model!.terminalbenchHard, 0.4)
  assert.equal(model!.intelligenceIndexTimePerTask, 60)
  assert.ok(!('scores' in model!))
  assert.ok(!('release' in model!))
})

test('renames the current payload performance block', () => {
  const [model] = parseLeaderboard(fakePage([
    published('model-a', { outputSpeed: 120, timeToFirstToken: 0.3, timeToFirstAnswerToken: 0.5 }),
  ]))
  assert.equal(model!.medianOutputTokensPerSecond, 120)
  assert.equal(model!.medianTimeToFirstTokenSeconds, 0.3)
  assert.equal(model!.medianTimeToFirstAnswerTokenSeconds, 0.5)
})

test('preserves absent performance keys as absent rather than null', () => {
  const [model] = parseLeaderboard(fakePage([published('model-a')]))
  assert.equal('medianOutputTokensPerSecond' in model!, false)
})

test('picks the widest models array, not the release mapping that shares the key', () => {
  const models = parseLeaderboard(legacyPage(legacyWide, [], narrow))
  assert.equal(models.length, 2)
  assert.equal(models[0]!.slug, 'model-a')
  assert.ok(!('releaseSlug' in models[0]!))
})

test('reads initialModels when the page no longer inlines every record under models', () => {
  const models = parseLeaderboard(fakePage([published('model-a'), published('model-b')]))
  assert.equal(models.length, 2)
  assert.equal(models[0]!.intelligenceIndex, 42.5)
})

test('rejects a page that only carries the narrow release mapping', () => {
  // Regression: this used to be cached as 700+ records with every statistic missing.
  assert.throws(() => parseLeaderboard(legacyPage(narrow, [], narrow)), /no model records found/)
})

test('extracts the encrypted dataset manifest from the page', () => {
  const manifest = { path: '/data/abc.txt', key: 'aabbcc' }
  const page = parsePage(fakePage([published('model-a')], [], 'initialModels', manifest))
  assert.deepEqual(page.manifest, manifest)
  assert.equal(page.models.length, 1)
})

test('decrypts and decompresses a manifest dataset', async () => {
  const keyHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
  const raw = new Uint8Array(keyHex.length / 2)
  for (let i = 0; i < raw.length; i++) raw[i] = Number.parseInt(keyHex.slice(i * 2, i * 2 + 2), 16)
  const iv = new Uint8Array(await crypto.subtle.digest('SHA-256', raw)).slice(0, 12)
  const rows = [{ slug: 'model-a', name: 'Model A' }]

  const compressed = await new Response(
    new Blob([JSON.stringify(rows)]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, compressed)

  assert.deepEqual(await decodeManifest(encrypted, keyHex), rows)
})

test('joins release dates through the current release.slug reference', () => {
  const releases = [
    { slug: 'model-a', name: 'A', releaseDate: '2025-03-04', modelNames: [], creator: { slug: 'x', name: 'X' } },
  ]
  const models = parseLeaderboard(fakePage([published('model-a'), published('model-b')], releases))
  assert.equal(models[0]!.releaseDate, '2025-03-04')
  // A model with no matching release simply has no date, rather than being dropped.
  assert.equal(models[1]!.releaseDate, undefined)
  assert.equal(models.length, 2)
})

test('joins release dates through the legacy releaseSlug indirection', () => {
  const releases = [{ slug: 'rel-a', name: 'A', releaseDate: '2025-03-04', creator: { slug: 'x', name: 'X' } }]
  const mappings = [{ slug: 'model-a', name: 'Model A', releaseSlug: 'rel-a' }, { slug: 'model-b', name: 'Model B', releaseSlug: 'rel-missing' }]
  const models = parseLeaderboard(legacyPage(legacyWide, releases, mappings))
  assert.equal(models[0]!.releaseDate, '2025-03-04')
  assert.equal(models[1]!.releaseDate, undefined)
  assert.equal(models.length, 2)
})

test('fails loudly when the page no longer contains model records', () => {
  assert.throws(() => parseLeaderboard('<html>nothing here</html>'), /no model records found/)
})

test('survives a page with no release metadata', () => {
  const models = parseLeaderboard(fakePage([published('model-a')]))
  assert.equal(models.length, 1)
  assert.equal(models[0]!.releaseDate, undefined)
})
