import { build } from 'esbuild'
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeView, type View } from './view-config.js'
import type { Snapshot } from './types.js'

/**
 * Turn the viewer + a cached snapshot into a directory GitHub Pages can serve.
 *
 * GitHub Pages has no server, so the dynamic `/api` routes are replaced by three static
 * files: the snapshot, the saved view, and a browser bundle of the query engine. The
 * HTML is the same one the local server serves; a marker in its `<head>` is replaced
 * with the flag that switches the UI into static mode.
 */

const TEMPLATE = new URL('../public/index.html', import.meta.url)

/** Present in `public/index.html`; its absence means the template was restructured. */
export const STATIC_MARKER = '<!-- __STATIC_BOOTSTRAP__ -->'

const STATIC_BOOTSTRAP = '<script>window.__LLM_LEADERBOARD_STATIC__ = true</script>'

/**
 * Marks a directory as ours, so `export --out` can clear a previous build without ever
 * deleting an unrelated directory the user pointed it at by mistake.
 */
const MARKER_FILE = '.llm-leaderboard-site'

export interface SiteExportOptions {
  /** Directory to write. Cleared first if it holds a previous export. */
  out: string
  snapshot: Snapshot
  /** The view to publish as the site's initial state. */
  view: View
}

export interface SiteExportResult {
  /** Absolute output directory. */
  out: string
  /** Number of models written. */
  models: number
}

export async function exportSite(options: SiteExportOptions): Promise<SiteExportResult> {
  const out = resolve(options.out)
  const root = parse(out).root
  if (out === root || out === resolve('.')) {
    throw new Error(`refusing to export into ${out}`)
  }

  await prepareDirectory(out)
  // Claim the directory before writing, so a build that fails halfway is still
  // recognisable — and therefore clearable — on the next run.
  await writeFile(join(out, MARKER_FILE), '', 'utf8')
  await mkdir(join(out, 'assets'), { recursive: true })
  await mkdir(join(out, 'data'), { recursive: true })

  // The filter engine is TypeScript; bundle exactly the browser-safe subset.
  await build({
    entryPoints: [await clientEntry()],
    outfile: join(out, 'assets/client.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
  })

  const template = await readFile(TEMPLATE, 'utf8')
  if (!template.includes(STATIC_MARKER)) {
    throw new Error(`public/index.html is missing the ${STATIC_MARKER} marker`)
  }
  await writeFile(
    join(out, 'index.html'),
    template.replace(STATIC_MARKER, STATIC_BOOTSTRAP),
    'utf8',
  )

  const { fetchedAt, source, models } = options.snapshot
  await writeFile(
    join(out, 'data/models.json'),
    JSON.stringify({ fetchedAt, source, total: models.length, models }),
    'utf8',
  )
  await writeFile(
    join(out, 'data/view.json'),
    `${JSON.stringify(normalizeView(options.view), null, 2)}\n`,
    'utf8',
  )

  return { out, models: models.length }
}

/**
 * The bundle entry sits next to this module, but its extension differs between running
 * from source (`tsx src/index.ts export`) and from the compiled CLI (`node dist/index.js
 * export`). Pick whichever exists.
 */
async function clientEntry(): Promise<string> {
  for (const url of [new URL('./client.ts', import.meta.url), new URL('./client.js', import.meta.url)]) {
    const path = fileURLToPath(url)
    try {
      await access(path)
      return path
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('cannot find the browser client entry (client.ts or client.js)')
}

/**
 * An output directory is safe to clear only when it is empty, absent, or a previous
 * export of ours. This is the difference between rebuilding `site/` and deleting a
 * directory the user meant to keep.
 */
async function prepareDirectory(out: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(out)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(out, { recursive: true })
      return
    }
    throw error
  }

  if (entries.length === 0) return
  if (!entries.includes(MARKER_FILE)) {
    throw new Error(`refusing to overwrite ${out}: not a previous site export (no ${MARKER_FILE})`)
  }

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
}
