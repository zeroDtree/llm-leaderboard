import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flightPayload, parseLeaderboard, scanValue } from './aa.js'

/**
 * Build a page that mimics the shape of the real leaderboard: React flight chunks
 * carrying a wide `models` array, plus the narrower `modelsAndReleases` structure
 * that shares the `models` key.
 */
function fakePage(models: unknown[], releases: unknown[] = [], mappings: unknown[] = []): string {
  const payload = [
    '21:["$","div",null,{"className":"container","children":[["$","$L22",null,{"models":',
    JSON.stringify(models),
    '}]]}',
    'd:{"modelsAndReleases":',
    JSON.stringify({ releases, models: mappings }),
    '}',
  ].join('')
  // The real page streams this as a JSON-escaped string argument.
  return `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`
}

const wide = [
  { slug: 'model-a', name: 'Model A', intelligenceIndex: 42.5, contextWindowTokens: 1000, isOpenWeights: true, price1mInputTokens: 1, price1mOutputTokens: 2 },
  { slug: 'model-b', name: 'Model B', intelligenceIndex: 11, contextWindowTokens: 2000, isOpenWeights: false, price1mInputTokens: null, price1mOutputTokens: null },
]
// Six fields shorter than `wide` — the parser must not pick this one.
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
