import { Service, type Context } from 'cordis'
import Schema from 'schemastery'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Snapshot } from './types.js'

declare module 'cordis' {
  interface Context {
    store: Store
  }
}

/**
 * Snapshots on disk, so the viewer works with no network and a re-scrape is never
 * required just to look at the data again.
 */
export class Store extends Service {
  static Config = Schema.object({
    dir: Schema.string().default('.cache').description('Directory for cached snapshots.'),
  })

  private readonly dir: string

  constructor(ctx: Context, config: { dir: string }) {
    super(ctx, 'store')
    this.dir = resolve(config.dir)
  }

  private pathFor(name: string): string {
    return join(this.dir, `${name}.json`)
  }

  /** Returns `null` when nothing has been scraped yet. */
  async read(name = 'models'): Promise<Snapshot | null> {
    try {
      return JSON.parse(await readFile(this.pathFor(name), 'utf8')) as Snapshot
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(snapshot: Snapshot, name = 'models'): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    const path = this.pathFor(name)
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    return path
  }
}
