/**
 * The record shape published by Artificial Analysis.
 *
 * Field names are kept exactly as they appear in the site's own payload so that the
 * scraper stays a thin translation layer and a schema change is easy to diff.
 *
 * Two properties of this data drive most of the code that follows:
 *
 *  - `undefined` and `null` are different things. Fields that are `null` are *published
 *    as empty* (e.g. a model with no public pricing). Fields that are `undefined` are
 *    *omitted from the record entirely* — Artificial Analysis does this for the whole
 *    performance block on models they have not benchmarked for speed. Read through
 *    {@link getField} rather than indexing directly.
 *  - Roughly a third of models carry no pricing at all, so any price filter must decide
 *    what "unknown" means. We treat it as "does not match" rather than as zero.
 */
export interface ModelRecord {
  // -- identity ------------------------------------------------------------
  slug: string
  name: string
  shortName: string
  modelCreatorName: string
  modelCreatorColor: string
  modelCreatorLogo: string
  deprecated: boolean
  isReasoning: boolean
  isOpenWeights: boolean

  // -- joined from the page's `modelsAndReleases` payload -------------------
  /** ISO `YYYY-MM-DD`. Present on every record after {@link ../aa.js} joins it in. */
  releaseDate?: string

  // -- capability ----------------------------------------------------------
  intelligenceIndex?: number | null
  intelligenceIndexIsEstimated: boolean
  contextWindowTokens: number
  paramClass?: string | null

  // -- pricing (USD per 1M tokens) ----------------------------------------
  priceClass?: string | null
  price1mInputTokens?: number | null
  price1mOutputTokens?: number | null
  cacheHitPrice?: number | null
  cacheWritePrice?: number | null
  intelligenceIndexCostPerTask?: number | null

  // -- performance (omitted entirely on un-benchmarked models) -------------
  medianOutputTokensPerSecond?: number
  percentile05OutputTokensPerSecond?: number
  quartile25OutputTokensPerSecond?: number
  quartile75OutputTokensPerSecond?: number
  percentile95OutputTokensPerSecond?: number
  medianTimeToFirstTokenSeconds?: number
  medianTimeToFirstAnswerTokenSeconds?: number
  percentile05TimeToFirstTokenSeconds?: number
  quartile25TimeToFirstTokenSeconds?: number
  quartile75TimeToFirstTokenSeconds?: number
  percentile95TimeToFirstTokenSeconds?: number
  medianEndToEndResponseTimeSeconds?: number
  medianReasoningTimeSeconds?: number | null

  // -- benchmarks ----------------------------------------------------------
  omniscience?: number | null
  omniscienceAccuracy?: number | null
  omniscienceNonHallucination?: number | null
  gdpvalNormalized?: number | null
  analystAgent?: number | null
  terminalbenchHard?: number | null
  terminalBench21?: number | null
  terminalBench40?: number | null
  tau2?: number | null
  tauBanking?: number | null
  lcr?: number | null
  hle?: number | null
  gpqa?: number | null
  scicode?: number | null
  ifbench?: number | null
  critpt?: number | null
  apexAgents?: number | null
  itbenchSre?: number | null
  mmmuPro?: number | null
}

/**
 * The keys Artificial Analysis emits, in payload order.
 *
 * This is the census taken over all 703 records. It exists so the field registry can
 * expose every published field for filtering without the two lists drifting apart —
 * {@link ../fields.js} builds its accessors from this array.
 */
export const RAW_KEYS = [
  'slug', 'name', 'shortName', 'deprecated', 'isReasoning', 'isOpenWeights', 'paramClass',
  'priceClass', 'modelCreatorName', 'modelCreatorColor', 'modelCreatorLogo', 'contextWindowTokens',
  'intelligenceIndex', 'intelligenceIndexIsEstimated', 'omniscience', 'omniscienceAccuracy',
  'omniscienceNonHallucination', 'gdpvalNormalized', 'analystAgent', 'terminalbenchHard',
  'terminalBench21', 'terminalBench40', 'tau2', 'tauBanking', 'lcr', 'hle', 'gpqa', 'scicode',
  'ifbench', 'critpt', 'apexAgents', 'itbenchSre', 'mmmuPro', 'price1mInputTokens',
  'price1mOutputTokens', 'cacheHitPrice', 'cacheWritePrice', 'medianOutputTokensPerSecond',
  'percentile05OutputTokensPerSecond', 'quartile25OutputTokensPerSecond',
  'quartile75OutputTokensPerSecond', 'percentile95OutputTokensPerSecond',
  'medianTimeToFirstTokenSeconds', 'medianTimeToFirstAnswerTokenSeconds',
  'percentile05TimeToFirstTokenSeconds', 'quartile25TimeToFirstTokenSeconds',
  'quartile75TimeToFirstTokenSeconds', 'percentile95TimeToFirstTokenSeconds',
  'medianEndToEndResponseTimeSeconds', 'medianReasoningTimeSeconds',
  'intelligenceIndexCostPerTask',
] as const

export type RawKey = typeof RAW_KEYS[number]

/** A timestamped scrape, as persisted by the store. */
export interface Snapshot {
  /** ISO instant the scrape completed. */
  fetchedAt: string
  /** Where it came from, for provenance. */
  source: string
  models: ModelRecord[]
}
