import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileFilter, FilterError } from './filter.js'
import { fieldAccessors, suggestField } from './fields.js'
import type { ModelRecord } from './types.js'

const accessors = fieldAccessors()

/** Hand-built records with round numbers, so every expectation is exact. */
const base = {
  shortName: '', modelCreatorColor: '#000', modelCreatorLogo: '', contextWindowTokens: 1000,
  intelligenceIndexIsEstimated: false, releaseDate: '2025-01-01',
}

const MODELS = [
  { ...base, slug: 'alpha', name: 'Alpha', modelCreatorName: 'Acme', deprecated: false, isReasoning: true, isOpenWeights: true, intelligenceIndex: 50, price1mInputTokens: 1, price1mOutputTokens: 3 },
  { ...base, slug: 'beta', name: 'Beta', modelCreatorName: 'Globex', deprecated: true, isReasoning: false, isOpenWeights: false, intelligenceIndex: 30, price1mInputTokens: 0.4, price1mOutputTokens: 0.8 },
  // No published price at all — the case that must not read as "free".
  { ...base, slug: 'gamma', name: 'Gamma', modelCreatorName: 'Acme', deprecated: false, isReasoning: true, isOpenWeights: true, intelligenceIndex: 10 },
  { ...base, slug: 'delta-4', name: 'Delta-4', modelCreatorName: 'Initech', deprecated: false, isReasoning: false, isOpenWeights: false, intelligenceIndex: 70, price1mInputTokens: 80, price1mOutputTokens: 160 },
  { ...base, slug: 'epsilon', name: 'Epsilon', modelCreatorName: 'Acme', deprecated: false, isReasoning: true, isOpenWeights: true, intelligenceIndex: 20, price1mInputTokens: 0.8, price1mOutputTokens: 1.2 },
  { ...base, slug: 'zeta', name: 'Zeta', modelCreatorName: 'Globex', deprecated: false, isReasoning: false, isOpenWeights: false, price1mInputTokens: 0.8, price1mOutputTokens: 1.6 },
] as unknown as ModelRecord[]

const slugs = (query: string): string[] =>
  MODELS.filter(compileFilter(query, accessors)).map((m) => m.slug)

test('an empty expression matches everything', () => {
  assert.equal(slugs('').length, 6)
  assert.equal(slugs('   ').length, 6)
})

test('blended price is (3 x input + output) / 4', () => {
  assert.deepEqual(slugs('price < 1'), ['beta', 'epsilon'])   // 0.5 and 0.9
  assert.deepEqual(slugs('price < 1.5'), ['beta', 'epsilon', 'zeta'])   // zeta blends to exactly 1.0
  assert.deepEqual(slugs('price >= 100'), ['delta-4'])
})

test('models with no published price never satisfy a comparison', () => {
  // `gamma` has no pricing; it must not be treated as free.
  assert.ok(!slugs('price < 1').includes('gamma'))
  assert.ok(!slugs('price >= 0').includes('gamma'))
  assert.ok(slugs('price >= 0').includes('delta-4'))
  // `zeta` omits intelligenceIndex entirely, so an ordering test excludes it too.
  assert.ok(!slugs('intelligence > 0').includes('zeta'))
  assert.ok(slugs('intelligence > 0').includes('gamma'))
})

test('null is only reachable through an explicit test', () => {
  assert.deepEqual(slugs('price == null'), ['gamma'])
  assert.deepEqual(slugs('price != null').sort(), ['alpha', 'beta', 'delta-4', 'epsilon', 'zeta'])
})

test('comparison operators', () => {
  assert.deepEqual(slugs('intelligence > 40'), ['alpha', 'delta-4'])
  assert.deepEqual(slugs('intelligence >= 50'), ['alpha', 'delta-4'])
  assert.deepEqual(slugs('intelligence <= 20'), ['gamma', 'epsilon'])
  assert.deepEqual(slugs('intelligence != 30'), ['alpha', 'gamma', 'delta-4', 'epsilon'])
})

test('string comparison is case-insensitive and booleans compare as themselves', () => {
  assert.deepEqual(slugs('creator == acme'), ['alpha', 'gamma', 'epsilon'])
  assert.deepEqual(slugs('creator == "Acme"'), ['alpha', 'gamma', 'epsilon'])
  assert.deepEqual(slugs('isReasoning == true'), ['alpha', 'gamma', 'epsilon'])
  assert.deepEqual(slugs('deprecated = true'), ['beta'])
})

test('contains, including the bare ~ form', () => {
  assert.deepEqual(slugs('name ~ delt'), ['delta-4'])
  assert.deepEqual(slugs('name ~= DELTA'), ['delta-4'])
  assert.deepEqual(slugs('name !~ elt'), ['alpha', 'beta', 'gamma', 'epsilon', 'zeta'])
  // A negation is not a way in to missing data either.
  assert.deepEqual(slugs('hle != 1'), [])
  assert.deepEqual(slugs('hle == null'), ['alpha', 'beta', 'gamma', 'delta-4', 'epsilon', 'zeta'])
})

test('a bare field asserts it holds a value', () => {
  assert.deepEqual(slugs('deprecated'), ['beta'])
  assert.deepEqual(slugs('not deprecated'), ['alpha', 'gamma', 'delta-4', 'epsilon', 'zeta'])
  assert.deepEqual(slugs('openWeights'), ['alpha', 'gamma', 'epsilon'])
  // `zeta` omits intelligenceIndex entirely; `gamma` has price omitted.
  assert.equal(slugs('intelligence').length, 5)
})

test('implicit AND by juxtaposition', () => {
  assert.deepEqual(slugs('price < 1 openWeights'), ['epsilon'])
  assert.deepEqual(slugs('price < 1 and openWeights'), ['epsilon'])
  assert.deepEqual(slugs('price<1&&openWeights'), ['epsilon'])
  assert.deepEqual(slugs('price<1 openWeights not deprecated'), ['epsilon'])
})

test('or binds looser than and, and both symbolic forms lex', () => {
  assert.deepEqual(slugs('price < 1 || price >= 100').sort(), ['beta', 'delta-4', 'epsilon'])
  assert.deepEqual(slugs('price < 1 or price >= 100').sort(), ['beta', 'delta-4', 'epsilon'])
  // `or` after a complete comparison must not be swallowed as a field name.
  assert.deepEqual(slugs('(price < 1 or price >= 100) and openWeights'), ['epsilon'])
  assert.deepEqual(slugs('creator == Acme or creator == Initech').sort(), ['alpha', 'delta-4', 'epsilon', 'gamma'])
})

test('not negates a whole predicate, and uncomparables still pass through it', () => {
  assert.deepEqual(slugs('not (price < 1)').sort(), ['alpha', 'delta-4', 'gamma', 'zeta'])
  assert.deepEqual(slugs('!(price < 1)').sort(), ['alpha', 'delta-4', 'gamma', 'zeta'])
})

test('in matches any listed value', () => {
  assert.deepEqual(slugs('creator in (Acme, Initech)').sort(), ['alpha', 'delta-4', 'epsilon', 'gamma'])
  assert.deepEqual(slugs('creator in (Globex)').sort(), ['beta', 'zeta'])
  assert.deepEqual(slugs('creator in ("Acme")').sort(), ['alpha', 'epsilon', 'gamma'])
  assert.deepEqual(slugs('intelligence in (50, 70)').sort(), ['alpha', 'delta-4'])
})

test('aliases resolve to the same field', () => {
  assert.deepEqual(slugs('intelligence > 40'), slugs('index > 40'))
  assert.deepEqual(slugs('creator == Acme'), slugs('modelCreator == Acme'))
  assert.deepEqual(slugs('context >= 1000'), slugs('contextWindow >= 1000'))
})

test('malformed expressions raise FilterError with a position', () => {
  const bad = ['price <', 'nonsense > 1', 'price << 1', 'creator == "oops', '(price < 1', 'price < 1)', 'price < 1 & 2']
  for (const query of bad) {
    assert.throws(() => compileFilter(query, accessors), FilterError, `expected failure for: ${query}`)
  }
})

test('a single & or | is reported as a likely typo', () => {
  assert.throws(() => compileFilter('a & b', accessors), /did you mean "&&"/)
})

test('unknown field errors name the field, and suggest a near miss', () => {
  assert.throws(() => compileFilter('nonsense > 1', accessors), /unknown field "nonsense"/)
  // Without a suggester the message stays bare; the CLI and server pass one.
  assert.throws(() => compileFilter('intelligences > 1', accessors), /^FilterError: unknown field "intelligences" \(at 0\)$/)
  assert.throws(
    () => compileFilter('intelligences > 1', accessors, { suggest: suggestField }),
    /did you mean "intelligence"\?/,
  )
})

test('age is derived from the release date', () => {
  const longAgo = [{ ...base, slug: 'old', name: 'Old', releaseDate: '2020-01-01', price1mInputTokens: 1, price1mOutputTokens: 1 }] as unknown as ModelRecord[]
  assert.equal(longAgo.filter(compileFilter('age > 1000', accessors)).length, 1)
  assert.equal(longAgo.filter(compileFilter('age < 10', accessors)).length, 0)
})
