import { Service, type Context } from 'cordis'
import Schema from 'schemastery'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DEFAULT_VIEW, normalizeView, VIEW_VERSION, type View } from './view-config.js'

export { DEFAULT_VIEW, normalizeView, VIEW_VERSION, type View }

declare module 'cordis' {
  interface Context {
    view: ViewService
  }
}

/** Reads and writes the saved view. */
export class ViewService extends Service {
  static Config = Schema.object({
    file: Schema.string().default('view.json').description('Where the saved view is kept.'),
  })

  private readonly path: string
  private current: View = { ...DEFAULT_VIEW, columns: [...DEFAULT_VIEW.columns] }

  constructor(ctx: Context, config: { file: string }) {
    super(ctx, 'view')
    this.path = resolve(config.file)
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const stored = await this.read()
    if (stored) this.current = stored
  }

  /** The current view. Always valid, even before anything has been saved. */
  get(): View {
    return this.current
  }

  /** Replace the view, writing it to disk. Accepts anything; returns what was stored. */
  async save(input: unknown): Promise<View> {
    this.current = normalizeView(input)
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8')
    return this.current
  }

  private async read(): Promise<View | null> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if ((parsed as View)?.version !== VIEW_VERSION) {
        this.ctx.logger('view').warn('reading a view of a different version; unknown parts will use defaults')
      }
      return normalizeView(parsed)
    } catch (error) {
      // A corrupt or half-written file must not stop the app from starting.
      this.ctx.logger('view').warn('ignoring unreadable', this.path, '-', (error as Error).message)
      return null
    }
  }
}
