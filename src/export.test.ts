import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportSite, STATIC_MARKER } from './export-site.js'
import { DEFAULT_VIEW, normalizeView } from './view-config.js'
import type { Snapshot } from './types.js'

const snapshot: Snapshot = {
  fetchedAt: '2026-10-19T00:00:00.000Z',
  source: 'https://example.test/leaderboard',
  models: [
    {
      slug: 'alpha', name: 'Alpha', modelCreatorName: 'Acme', intelligenceIndex: 42,
      price1mInputTokens: 1, price1mOutputTokens: 3,
    },
    { slug: 'beta', name: 'Beta', modelCreatorName: 'Acme' },
  ] as unknown as Snapshot['models'],
}

test('export writes a self-contained static site', async () => {
  const out = await mkdtemp(join(tmpdir(), 'llm-leaderboard-site-'))
  try {
    const result = await exportSite({ out, snapshot, view: DEFAULT_VIEW })
    assert.equal(result.models, 2)

    const html = await readFile(join(out, 'index.html'), 'utf8')
    assert.ok(!html.includes(STATIC_MARKER), 'the static marker should be replaced')
    assert.match(html, /__LLM_LEADERBOARD_STATIC__/)

    const data = JSON.parse(await readFile(join(out, 'data/models.json'), 'utf8'))
    assert.equal(data.total, 2)
    assert.equal(data.fetchedAt, snapshot.fetchedAt)
    assert.equal(data.models[0].slug, 'alpha')

    const view = JSON.parse(await readFile(join(out, 'data/view.json'), 'utf8'))
    assert.deepEqual(view, normalizeView(DEFAULT_VIEW))

    // The browser bundle must carry the query engine, not just an empty module.
    const bundle = await readFile(join(out, 'assets/client.js'), 'utf8')
    assert.ok(bundle.length > 1000, `bundle is only ${bundle.length} bytes`)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
})

test('export refuses to clear a directory it did not create', async () => {
  const out = await mkdtemp(join(tmpdir(), 'llm-leaderboard-other-'))
  try {
    await writeFile(join(out, 'keep.txt'), 'not ours', 'utf8')
    await assert.rejects(
      exportSite({ out, snapshot, view: DEFAULT_VIEW }),
      /refusing to overwrite/,
    )
    assert.equal(await readFile(join(out, 'keep.txt'), 'utf8'), 'not ours')
  } finally {
    await rm(out, { recursive: true, force: true })
  }
})
