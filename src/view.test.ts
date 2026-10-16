import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VIEW, normalizeView, VIEW_VERSION } from './view.js'

test('a well-formed view round-trips', () => {
  const input = { version: 1, filter: 'price < 1', sort: 'price', order: 'asc', columns: ['name', 'price'] }
  assert.deepEqual(normalizeView(input), input)
})

test('anything unrecognised falls back to the defaults', () => {
  for (const input of [null, undefined, 42, 'nope', [], true]) {
    assert.deepEqual(normalizeView(input), DEFAULT_VIEW, `failed for ${JSON.stringify(input)}`)
  }
})

test('aliases resolve to canonical field names', () => {
  // `intelligence` is an alias; a saved view must not depend on which spelling was used.
  assert.equal(normalizeView({ sort: 'intelligence' }).sort, 'intelligenceIndex')
  assert.equal(normalizeView({ sort: 'intelligenceIndex' }).sort, 'intelligenceIndex')
  assert.deepEqual(normalizeView({ columns: ['creator', 'cost', 'mdl'] }).columns, ['modelCreatorName', 'price'])
})

test('one bad column does not cost the rest of the view', () => {
  assert.deepEqual(normalizeView({ columns: ['name', 'nonsense', 'price'] }).columns, ['name', 'price'])
})

test('a column list that resolves to nothing falls back rather than emptying the table', () => {
  assert.deepEqual(normalizeView({ columns: ['nope', 'also-nope'] }).columns, DEFAULT_VIEW.columns)
  assert.deepEqual(normalizeView({ columns: [] }).columns, DEFAULT_VIEW.columns)
})

test('columns are de-duplicated but keep their order', () => {
  assert.deepEqual(normalizeView({ columns: ['price', 'name', 'price', 'name'] }).columns, ['price', 'name'])
})

test('a bad sort or order falls back without discarding the filter', () => {
  const view = normalizeView({ filter: 'price < 1', sort: 'nonsense', order: 'sideways' })
  assert.equal(view.filter, 'price < 1')
  assert.equal(view.sort, DEFAULT_VIEW.sort)
  assert.equal(view.order, DEFAULT_VIEW.order)
})

test('the filter is kept verbatim, including an unfinished one', () => {
  // Mid-edit filters are a legitimate thing to save; the UI reports the syntax error.
  for (const filter of ['price <', 'name ~ "unclosed', '(((']) {
    assert.equal(normalizeView({ filter }).filter, filter)
  }
})

test('a non-string filter falls back and an oversized one is truncated', () => {
  assert.equal(normalizeView({ filter: 123 }).filter, DEFAULT_VIEW.filter)
  assert.equal(normalizeView({ filter: 'x'.repeat(20_000) }).filter.length, 10_000)
})

test('the version is always stamped, whatever came in', () => {
  assert.equal(normalizeView({ version: 99 }).version, VIEW_VERSION)
  assert.equal(normalizeView({}).version, VIEW_VERSION)
})

test('normalizeView never throws, whatever it is handed', () => {
  // Every value here is reachable from JSON.parse, which is the only thing that ever
  // feeds this function — a fetched body or a file on disk. (A throwing getter would
  // defeat it, but JSON cannot express one.)
  const hostile = [
    { columns: 'not-an-array' },
    { columns: [null, 42, {}, [], 'name'] },
    { sort: {} }, { sort: [] }, { order: 1 },
    { filter: null, sort: null, order: null, columns: null },
    Object.create(null),
  ]
  hostile.forEach((input, index) => {
    assert.doesNotThrow(() => normalizeView(input), `threw for input #${index}`)
  })
})
