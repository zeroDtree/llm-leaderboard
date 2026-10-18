import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { Query } from './query.js'
import type { ModelRecord } from './types.js'

const query = new Query(new Context())

const models = [
  { slug: 'alpha', name: 'Alpha', intelligenceIndex: 10 },
  { slug: 'beta', name: 'Beta', intelligenceIndex: null },
  { slug: 'gamma', name: 'Gamma', intelligenceIndex: 30 },
  { slug: 'delta', name: 'Delta' },
] as unknown as ModelRecord[]

const names = (order: 'asc' | 'desc') =>
  query.run(models, { sort: 'intelligence', order }).models.map((model) => model.name)

test('missing values sort last when descending', () => {
  // Regression: negating the comparison used to float unbounded rows to the top.
  assert.deepEqual(names('desc'), ['Gamma', 'Alpha', 'Beta', 'Delta'])
})

test('missing values sort last when ascending', () => {
  assert.deepEqual(names('asc'), ['Alpha', 'Gamma', 'Beta', 'Delta'])
})

test('equal values fall back to name order regardless of direction', () => {
  const tied = [
    { slug: 'b', name: 'Bravo', intelligenceIndex: 50 },
    { slug: 'a', name: 'Alpha', intelligenceIndex: 50 },
  ] as unknown as ModelRecord[]
  assert.deepEqual(query.run(tied, { sort: 'intelligence', order: 'desc' }).models.map((m) => m.name), ['Alpha', 'Bravo'])
  assert.deepEqual(query.run(tied, { sort: 'intelligence', order: 'asc' }).models.map((m) => m.name), ['Alpha', 'Bravo'])
})
