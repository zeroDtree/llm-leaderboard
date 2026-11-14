/**
 * The stable snapshot record shape.
 *
 * Artificial Analysis publishes a nested payload (the slug under `release`, benchmarks
 * under `scores`, `outputSpeed` for throughput); {@link ../aa.js} flattens it into these
 * names on the way in. Snapshots have used these names since the first version, so a
 * payload reshuffle does not invalidate saved views or filter expressions — the
 * payload's own names are registered as aliases in `fields.ts` instead.
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

  // -- joined from the page's release metadata ------------------------------
  /** ISO `YYYY-MM-DD`. Present on every record after {@link ../aa.js} joins it in. */
  releaseDate?: string

  // -- capability ----------------------------------------------------------
  intelligenceIndex?: number | null
  contextWindowTokens: number
  paramClass?: string | null

  // -- pricing (USD per 1M tokens) ----------------------------------------
  priceClass?: string | null
  price1mInputTokens?: number | null
  price1mOutputTokens?: number | null
  cacheHitPrice?: number | null
  cacheWritePrice?: number | null
  intelligenceIndexCostPerTask?: number | null
  /** Seconds per task, published alongside the cost. */
  intelligenceIndexTimePerTask?: number | null

  // -- performance (omitted entirely on un-benchmarked models) -------------
  medianOutputTokensPerSecond?: number
  medianTimeToFirstTokenSeconds?: number
  medianTimeToFirstAnswerTokenSeconds?: number

  // -- benchmarks ----------------------------------------------------------
  // AA's headline index and its components.
  omniscience?: number | null
  omniscienceAccuracy?: number | null
  omniscienceNonHallucination?: number | null
  // Agentic and knowledge work.
  gdpvalNormalized?: number | null
  gdpPdf?: number | null
  analystAgent?: number | null
  // Terminal / coding.
  terminalbenchHard?: number | null
  terminalBench21?: number | null
  terminalBench40?: number | null
  terminalBenchScience?: number | null
  tau2?: number | null
  tauBanking?: number | null
  lcr?: number | null
  multilingualLcr?: number | null
  livecodebench?: number | null
  frontierCode?: number | null
  frontierCode20?: number | null
  // Reasoning and general knowledge.
  hle?: number | null
  hleDiamond?: number | null
  gpqa?: number | null
  scicode?: number | null
  ifbench?: number | null
  critpt?: number | null
  critptV2Hard?: number | null
  aime2025?: number | null
  aaBriefcase?: number | null
  automationBench?: number | null
  // Domain-specific.
  apexAgents?: number | null
  itbenchSre?: number | null
  mmmuPro?: number | null
  enterpriseOpsGym?: number | null
  harveyLab?: number | null
  code2Video?: number | null
  aa3d?: number | null
  mka?: number | null
  vials?: number | null
  healthbench?: number | null
  healthbenchProfessional?: number | null
}

/**
 * The keys a snapshot record can carry, in display order.
 *
 * This is the census taken over the full dataset. It exists so the field registry can
 * expose every published field for filtering without the two lists drifting apart —
 * {@link ../fields.js} builds its accessors from this array.
 */
export const RAW_KEYS = [
  'slug', 'name', 'shortName', 'deprecated', 'isReasoning', 'isOpenWeights', 'paramClass',
  'priceClass', 'modelCreatorName', 'modelCreatorColor', 'modelCreatorLogo', 'contextWindowTokens',
  'intelligenceIndex', 'omniscience', 'omniscienceAccuracy', 'omniscienceNonHallucination',
  'gdpvalNormalized', 'gdpPdf', 'analystAgent', 'terminalbenchHard', 'terminalBench21',
  'terminalBench40', 'terminalBenchScience', 'tau2', 'tauBanking', 'lcr', 'multilingualLcr',
  'livecodebench', 'frontierCode', 'frontierCode20', 'hle', 'hleDiamond', 'gpqa', 'scicode',
  'ifbench', 'critpt', 'critptV2Hard', 'aime2025', 'aaBriefcase', 'automationBench',
  'apexAgents', 'itbenchSre', 'mmmuPro', 'enterpriseOpsGym', 'harveyLab', 'code2Video', 'aa3d',
  'mka', 'vials', 'healthbench', 'healthbenchProfessional', 'price1mInputTokens',
  'price1mOutputTokens', 'cacheHitPrice', 'cacheWritePrice', 'medianOutputTokensPerSecond',
  'medianTimeToFirstTokenSeconds', 'medianTimeToFirstAnswerTokenSeconds',
  'intelligenceIndexCostPerTask', 'intelligenceIndexTimePerTask',
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
