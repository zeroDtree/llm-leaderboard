import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeManifest, flightPayload, parseLeaderboard, parsePage, scanValue, type Manifest } from './aa.js'

/**
 * Build a page that mimics the shape of the real leaderboard: React flight chunks
 * carrying a wide model array, plus the narrower `modelsAndReleases` structure
 * that shares the `models` key.
 */
function fakePage(
  models: unknown[],
  releases: unknown[] = [],
  mappings: unknown[] = [],
  key = 'models',
  manifest?: Manifest,
): string {
  const payload = [
    `21:["$","div",null,{"className":"container","children":[["$","$L22",null,{"${key}":`,
    JSON.stringify(models),
    '}]]}',
    'd:{"modelsAndReleases":',
    JSON.stringify({ releases, models: mappings }),
    '}',
    manifest ? `e:{"manifest":${JSON.stringify(manifest)}}` : '',
  ].join('')
  // The real page streams this as a JSON-escaped string argument.
  return `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`
}

const wide = [
  { slug: 'model-a', name: 'Model A', deprecated: false, isReasoning: false, modelCreatorName: 'A', intelligenceIndex: 42.5, contextWindowTokens: 1000, isOpenWeights: true, price1mInputTokens: 1, price1mOutputTokens: 2 },
  { slug: 'model-b', name: 'Model B', deprecated: false, isReasoning: false, modelCreatorName: 'B', intelligenceIndex: 11, contextWindowTokens: 2000, isOpenWeights: false, price1mInputTokens: null, price1mOutputTokens: null },
]
// Seven fields shorter than `wide` — the parser must not pick this one.
const narrow = [{ slug: 'model-a', name: 'Model A', releaseSlug: 'rel-a' }]

test('decodes concatenated flight chunks', () => {
  const page = '<script>self.__next_f.push([1,"abc"])</script><script>self.__next_f.push([1,"def"])</script>'
  assert.equal(flightPayload(page), 'abcdef')
})

test('scanValue is string-aware', () => {
  const source = '[1, {"k": "] } ["}, 2]'
  assert.equal(scanValue(source, 0), source.length)
})

test('picks the widest models array, not the release mapping that shares the key', () => {
  const models = parseLeaderboard(fakePage(wide, [], narrow))
  assert.equal(models.length, 2)
  assert.equal(models[0]!.slug, 'model-a')
  assert.ok(!('releaseSlug' in models[0]!))
})

test('reads initialModels when the page no longer inlines every record under models', () => {
  const models = parseLeaderboard(fakePage(wide, [], narrow, 'initialModels'))
  assert.equal(models.length, 2)
  assert.equal(models[0]!.intelligenceIndex, 42.5)
})

test('rejects a page that only carries the narrow release mapping', () => {
  // Regression: this used to be cached as 700+ records with every statistic missing.
  assert.throws(() => parseLeaderboard(fakePage(narrow, [], narrow)), /no model records found/)
})

test('extracts the encrypted dataset manifest from the page', () => {
  const manifest = { path: '/data/abc.txt', key: 'aabbcc' }
  const page = parsePage(fakePage(wide, [], narrow, 'initialModels', manifest))
  assert.deepEqual(page.manifest, manifest)
  assert.equal(page.models.length, 2)
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

test('joins release dates through the releaseSlug indirection', () => {
  const releases = [{ slug: 'rel-a', name: 'A', releaseDate: '2025-03-04', creator: { slug: 'x', name: 'X' } }]
  const mappings = [{ slug: 'model-a', name: 'Model A', releaseSlug: 'rel-a' }, { slug: 'model-b', name: 'Model B', releaseSlug: 'rel-missing' }]
  const models = parseLeaderboard(fakePage(wide, releases, mappings))
  assert.equal(models[0]!.releaseDate, '2025-03-04')
  // A model with no matching release simply has no date, rather than being dropped.
  assert.equal(models[1]!.releaseDate, undefined)
  assert.equal(models.length, 2)
})

test('preserves absent performance keys as absent rather than null', () => {
  const models = parseLeaderboard(fakePage(wide, [], narrow))
  assert.equal('medianOutputTokensPerSecond' in models[0]!, false)
})

test('fails loudly when the page no longer contains model records', () => {
  assert.throws(() => parseLeaderboard('<html>nothing here</html>'), /no model records found/)
})

test('survives a page with no release metadata', () => {
  const models = parseLeaderboard(fakePage(wide))
  assert.equal(models.length, 2)
})
