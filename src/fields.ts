import { RAW_KEYS, type ModelRecord } from './types.js'

/**
 * How a field should be rendered. Filtering always operates on the raw value — this
 * only affects display, so `hle > 0.5` stays the way you would write it even though
 * the UI shows `50.0%`.
 */
export type FieldFormat = 'text' | 'number' | 'int' | 'score' | 'price' | 'percent' | 'date' | 'bool'

export type Accessor = (model: ModelRecord) => unknown

export interface FieldDef {
  /** The name you write in a filter expression. */
  name: string
  /** Human-readable column header. */
  label: string
  format: FieldFormat
  get: Accessor
  aliases: string[]
  /** Computed locally rather than published by Artificial Analysis. */
  derived?: boolean
}

/** Artificial Analysis blends pricing 3:1 input:output in their own headline metric. */
function blendedPrice(model: ModelRecord): number | null {
  const input = model.price1mInputTokens
  const output = model.price1mOutputTokens
  if (input == null || output == null) return null
  return (3 * input + output) / 4
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits))

/**
 * Fields computed on this side. Everything else is read straight off the record.
 *
 * `age` is derived at evaluation time rather than baked into the snapshot, so a cached
 * snapshot does not go stale.
 */
const DERIVED: FieldDef[] = [
  {
    name: 'price',
    label: 'Price',
    format: 'price',
    derived: true,
    aliases: ['blendedprice', 'cost', 'blended'],
    get: (m) => {
      const value = blendedPrice(m)
      return value == null ? null : round(value, 3)
    },
  },
  {
    name: 'age',
    label: 'Age',
    format: 'int',
    derived: true,
    aliases: ['agedays'],
    get: (m) => (m.releaseDate ? Math.floor((Date.now() - Date.parse(m.releaseDate)) / 86_400_000) : null),
  },
]

/**
 * Fields the scraper joins in from the page's release metadata. These are part of the
 * final record shape but are not part of Artificial Analysis's own per-model payload,
 * so they are registered separately from {@link RAW_KEYS}.
 */
const JOINED: FieldDef[] = [
  {
    name: 'releaseDate',
    label: 'Released',
    format: 'date',
    aliases: ['released', 'release', 'date'],
    get: (m) => m.releaseDate ?? null,
  },
]

/** Display metadata for the published fields. Anything absent falls back to a generic entry. */
const META: Record<string, { label: string; format: FieldFormat; aliases?: string[] }> = {
  slug: { label: 'Slug', format: 'text' },
  name: { label: 'Model', format: 'text', aliases: ['model'] },
  shortName: { label: 'Short name', format: 'text' },
  modelCreatorName: { label: 'Creator', format: 'text', aliases: ['creator', 'author', 'vendor', 'modelCreator'] },
  modelCreatorColor: { label: 'Creator colour', format: 'text' },
  modelCreatorLogo: { label: 'Creator logo', format: 'text' },
  deprecated: { label: 'Deprecated', format: 'bool' },
  isReasoning: { label: 'Reasoning', format: 'bool', aliases: ['reasoning', 'reasoner'] },
  isOpenWeights: { label: 'Open weights', format: 'bool', aliases: ['openweights', 'open'] },
  intelligenceIndex: { label: 'Intelligence', format: 'score', aliases: ['intelligence', 'index', 'iq'] },
  intelligenceIndexIsEstimated: { label: 'Index estimated', format: 'bool' },
  intelligenceIndexCostPerTask: { label: 'Cost per task', format: 'price', aliases: ['costpertask', 'pricepertask'] },
  contextWindowTokens: { label: 'Context', format: 'int', aliases: ['context', 'contextwindow'] },
  paramClass: { label: 'Param class', format: 'text' },
  priceClass: { label: 'Price class', format: 'text' },
  price1mInputTokens: { label: 'Input $/1M', format: 'price', aliases: ['input', 'inputprice'] },
  price1mOutputTokens: { label: 'Output $/1M', format: 'price', aliases: ['output', 'outputprice'] },
  cacheHitPrice: { label: 'Cache hit $/1M', format: 'price' },
  cacheWritePrice: { label: 'Cache write $/1M', format: 'price' },
  medianOutputTokensPerSecond: { label: 'Speed', format: 'number', aliases: ['speed', 'tps', 'throughput', 'outputspeed'] },
  percentile05OutputTokensPerSecond: { label: 'Speed p05', format: 'number' },
  quartile25OutputTokensPerSecond: { label: 'Speed p25', format: 'number' },
  quartile75OutputTokensPerSecond: { label: 'Speed p75', format: 'number' },
  percentile95OutputTokensPerSecond: { label: 'Speed p95', format: 'number' },
  medianTimeToFirstTokenSeconds: { label: 'TTFT', format: 'number', aliases: ['ttft', 'firsttoken'] },
  medianTimeToFirstAnswerTokenSeconds: { label: 'TTFA', format: 'number', aliases: ['ttfa'] },
  percentile05TimeToFirstTokenSeconds: { label: 'TTFT p05', format: 'number' },
  quartile25TimeToFirstTokenSeconds: { label: 'TTFT p25', format: 'number' },
  quartile75TimeToFirstTokenSeconds: { label: 'TTFT p75', format: 'number' },
  percentile95TimeToFirstTokenSeconds: { label: 'TTFT p95', format: 'number' },
  medianEndToEndResponseTimeSeconds: { label: 'Latency', format: 'number', aliases: ['latency', 'e2e'] },
  medianReasoningTimeSeconds: { label: 'Reasoning time', format: 'number' },
  omniscience: { label: 'Omniscience', format: 'percent' },
  omniscienceAccuracy: { label: 'AA-Omniscience acc.', format: 'percent' },
  omniscienceNonHallucination: { label: 'AA-Omniscience non-halluc.', format: 'percent' },
  gdpvalNormalized: { label: 'GDPval', format: 'percent' },
  analystAgent: { label: 'Analyst agent', format: 'percent' },
  terminalbenchHard: { label: 'Terminal-Bench Hard', format: 'percent' },
  terminalBench21: { label: 'Terminal-Bench 2.1', format: 'percent' },
  terminalBench40: { label: 'Terminal-Bench 4.0', format: 'percent' },
  tau2: { label: 'Tau2', format: 'percent' },
  tauBanking: { label: 'Tau-Banking', format: 'percent' },
  lcr: { label: 'LCR', format: 'percent' },
  hle: { label: 'HLE', format: 'percent' },
  gpqa: { label: 'GPQA', format: 'percent' },
  scicode: { label: 'SciCode', format: 'percent' },
  ifbench: { label: 'IFBench', format: 'percent' },
  critpt: { label: 'CritPt', format: 'percent' },
  apexAgents: { label: 'APEX-Agents', format: 'percent' },
  itbenchSre: { label: 'ITBench-SRE', format: 'percent' },
  mmmuPro: { label: 'MMMU-Pro', format: 'percent' },
}

function makeRawField(key: string): FieldDef {
  const meta = META[key]
  return {
    name: key,
    label: meta?.label ?? key,
    format: meta?.format ?? 'number',
    aliases: meta?.aliases ?? [],
    get: (m) => (m[key as keyof ModelRecord] === undefined ? null : m[key as keyof ModelRecord]),
  }
}

/**
 * Every field you can write in a filter expression, canonical names first.
 *
 * Built from {@link RAW_KEYS} rather than a hand-written list so a field added to the
 * payload shows up here automatically, defaulting to a plain numeric column.
 */
export const FIELDS: FieldDef[] = [...DERIVED, ...JOINED, ...RAW_KEYS.map(makeRawField)]

/** Look up a field by canonical name or alias. Case-insensitive; `undefined` if unknown. */
export function findField(name: string): FieldDef | undefined {
  return FIELD_MAP.get(name.toLowerCase())
}

/**
 * Look up a field by canonical name or alias.
 *
 * Alias-aware on purpose: a saved view may say `sort: "intelligence"` where the canonical
 * name is `intelligenceIndex`, and both must mean the same thing. Callers that need to
 * report an unknown name to a user should use {@link findField} and raise their own error.
 *
 * @throws {Error} when the name is not a known field — an internal invariant, not input.
 */
export function fieldByName(name: string): FieldDef {
  const field = findField(name)
  if (!field) throw new Error(`internal error: no such field "${name}"`)
  return field
}

/** Lookup by canonical name or any alias, all case-insensitive. */
export const FIELD_MAP: ReadonlyMap<string, FieldDef> = new Map(
  FIELDS.flatMap((field) => [
    [field.name.toLowerCase(), field] as const,
    // Aliases are declared in camelCase for readability but must be keyed lowercased,
    // since lookups always lowercase the name the user typed.
    ...field.aliases.map((alias) => [alias.toLowerCase(), field] as const),
  ]),
)

/** The accessor table consumed by the filter compiler. */
export function fieldAccessors(): Record<string, Accessor> {
  return Object.fromEntries([...FIELD_MAP].map(([key, field]) => [key, field.get]))
}

/** Levenshtein-ish suggestion for a mistyped field name. */
export function suggestField(name: string): string | undefined {
  const target = name.toLowerCase()
  let best: { name: string; distance: number } | undefined
  for (const candidate of FIELD_MAP.keys()) {
    const distance = editDistance(target, candidate)
    if (!best || distance < best.distance) best = { name: candidate, distance }
  }
  // Only suggest when it is plausibly a typo rather than an unrelated word.
  if (!best || best.distance > Math.max(2, Math.floor(target.length / 3))) return undefined
  return best.name
}

function editDistance(a: string, b: string): number {
  const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(rows[i - 1]![j]! + 1, row[j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
    }
    rows.push(row)
  }
  return rows[a.length]![b.length]!
}

/**
 * Attach derived fields as real properties.
 *
 * `price` and `age` are computed by accessors rather than stored, so they exist for
 * filtering but not on the record itself. API consumers want to read them directly,
 * so materialize them on the way out.
 */
export function materialize(model: ModelRecord): ModelRecord & Record<string, unknown> {
  const out = { ...model } as ModelRecord & Record<string, unknown>
  for (const field of FIELDS) {
    if (field.derived) out[field.name] = field.get(model)
  }
  return out
}

/** Coverage counts, used to tell the UI which columns are worth showing. */
export function coverage(models: ModelRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const field of FIELDS) {
    counts[field.name] = models.reduce((n, m) => (field.get(m) == null ? n : n + 1), 0)
  }
  return counts
}

/**
 * Render a USD price per 1M tokens.
 *
 * Sub-cent prices keep two significant figures — rounding them to cents would print
 * `$0.00` and read as free, which is a different claim.
 */
export function formatPrice(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${Number(value.toPrecision(2))}`
  return `$${value.toFixed(2)}`
}

/** Render a value for display, honouring the field's format. */
export function formatValue(field: FieldDef, value: unknown): string {
  if (value == null || value === '') return '—'
  switch (field.format) {
    case 'percent': return `${(Number(value) * 100).toFixed(1)}%`
    case 'price': return formatPrice(Number(value))
    case 'score': return Number(value).toFixed(1)
    case 'number': return Number(value).toFixed(1)
    case 'int': return Number(value).toLocaleString('en-US')
    case 'bool': return value ? 'yes' : 'no'
    default: return String(value)
  }
}
