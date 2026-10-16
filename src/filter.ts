import type { ModelRecord } from './types.js'
import type { Accessor } from './fields.js'

/**
 * A small expression language for selecting models.
 *
 *   price < 1
 *   price < 1 and openWeights
 *   creator == Anthropic and not deprecated
 *   name ~ claude or context >= 1000000
 *   creator in (Anthropic, OpenAI, Google)
 *
 * Grammar — `and` binds tighter than `or`, and juxtaposition is `and`, so
 * `price < 1 openWeights` means `price < 1 and openWeights`:
 *
 *   or      := and (("or" | "||") and)*
 *   and     := unary (("and" | "&&")? unary)*
 *   unary   := ("not" | "!") unary | primary
 *   primary := "(" or ")" | field | field OP value | field "in" "(" value, ... ")"
 *
 * Hand-written rather than `eval`-based: it parses to a small tree of closures over
 * accessors, so there is no code-injection surface and unknown fields fail with a
 * position instead of a `ReferenceError`.
 */

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=' | '~=' | '!~'

/** A parse or resolution failure, carrying the character offset for inline display. */
export class FilterError extends Error {
  readonly pos: number | undefined

  constructor(message: string, pos?: number) {
    super(pos == null ? message : `${message} (at ${pos})`)
    this.name = 'FilterError'
    this.pos = pos
  }
}

type Scalar = { v: unknown }

export interface FilterOptions {
  /** Optional field-name suggester, used to turn a typo into a helpful message. */
  suggest?: (name: string) => string | undefined
}

type Node =
  | { op: 'and' | 'or'; l: Node; r: Node }
  | { op: 'not'; r: Node }
  | { op: 'truthy'; field: string; pos: number }
  | { op: 'in'; field: string; pos: number; vals: Scalar[] }
  | { op: 'cmp'; cmp: CompareOp; field: string; pos: number; rhs: Scalar }

type Token =
  | { k: 'num'; v: number; i: number }
  | { k: 'str'; v: string; i: number }
  | { k: 'word'; v: string; i: number }
  | { k: 'op'; v: CompareOp; i: number }
  | { k: 'not'; i: number }
  | { k: 'and' | 'or'; i: number }
  | { k: '(' | ')' | ','; i: number }

const OPS = new Set<string>(['<=', '>=', '==', '!=', '~=', '!~', '<', '>', '='])
const WORD = /^[A-Za-z_][A-Za-z0-9_.\-]*/
const NUM = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/
const closesOperand = new Set(['or', 'and'])

function lex(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) { i++; continue }
    if (c === '(' || c === ')' || c === ',') { out.push({ k: c, i }); i++; continue }

    // `&&` / `||` are lexed as the same tokens as the `and` / `or` keywords. A single
    // `&` or `|` is a typo, not a bitwise operator, so say so rather than failing later.
    if (c === '&' || c === '|') {
      if (src[i + 1] !== c) throw new FilterError(`unexpected character ${JSON.stringify(c)} — did you mean "${c}${c}"?`, i)
      out.push({ k: c === '&' ? 'and' : 'or', i })
      i += 2
      continue
    }

    const pair = src.slice(i, i + 2)
    if (OPS.has(pair)) { out.push({ k: 'op', v: pair as CompareOp, i }); i += 2; continue }
    if (c === '!') { out.push({ k: 'not', i }); i++; continue }
    if (OPS.has(c) || c === '~') {
      out.push({ k: 'op', v: (c === '=' ? '==' : c === '~' ? '~=' : c) as CompareOp, i })
      i++; continue
    }

    if (c === '"' || c === "'") {
      let j = i + 1
      let value = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { value += src[j + 1] ?? ''; j += 2 } else { value += src[j]; j++ }
      }
      if (j >= src.length) throw new FilterError('unterminated string', i)
      out.push({ k: 'str', v: value, i })
      i = j + 1
      continue
    }

    if (c === '-' && /\d/.test(src[i + 1] ?? '')) {
      const m = NUM.exec(src.slice(i + 1))!
      out.push({ k: 'num', v: -Number(m[0]), i })
      i += 1 + m[0].length
      continue
    }
    const num = NUM.exec(src.slice(i))
    if (num) { out.push({ k: 'num', v: Number(num[0]), i }); i += num[0].length; continue }

    const word = WORD.exec(src.slice(i))
    if (word) { out.push({ k: 'word', v: word[0], i }); i += word[0].length; continue }

    throw new FilterError(`unexpected character ${JSON.stringify(c)}`, i)
  }
  return out
}

function parse(tokens: Token[]): Node {
  let p = 0
  const peek = (): Token | undefined => tokens[p]
  const eat = (): Token | undefined => tokens[p++]
  const isWord = (t: Token | undefined, ...words: string[]): boolean =>
    !!t && t.k === 'word' && words.includes(t.v.toLowerCase())

  function expect(kind: '(' | ')'): Token {
    const t = eat()
    if (!t || t.k !== kind) throw new FilterError(`expected "${kind}"`, t?.i ?? undefined)
    return t
  }

  function parseOr(): Node {
    let node = parseAnd()
    while (isWord(peek(), 'or') || peek()?.k === 'or') {
      eat()
      node = { op: 'or', l: node, r: parseAnd() }
    }
    return node
  }

  function parseAnd(): Node {
    let node = parseUnary()
    for (;;) {
      const t = peek()
      if (isWord(t, 'and') || t?.k === 'and') {
        eat()
        node = { op: 'and', l: node, r: parseUnary() }
        continue
      }
      // Juxtaposition is `and`, but only when an operand really starts here — otherwise a
      // trailing `or` would be swallowed as a field name.
      const startsOperand = !!t && (t.k === '(' || t.k === 'not' || (t.k === 'word' && !closesOperand.has(t.v.toLowerCase())))
      if (startsOperand) { node = { op: 'and', l: node, r: parseUnary() }; continue }
      return node
    }
  }

  function parseUnary(): Node {
    if (isWord(peek(), 'not') || peek()?.k === 'not') { eat(); return { op: 'not', r: parseUnary() } }
    return parsePrimary()
  }

  function parsePrimary(): Node {
    if (peek()?.k === '(') { eat(); const node = parseOr(); expect(')'); return node }

    const field = eat()
    if (!field || field.k !== 'word') throw new FilterError('expected a field name', field?.i)

    const op = peek()
    if (isWord(op, 'in')) {
      eat()
      expect('(')
      const vals: Scalar[] = []
      for (;;) {
        vals.push(parseScalar())
        const next = peek()
        if (next?.k === ')') break
        if (next?.k !== ',') throw new FilterError('expected "," or ")"', next?.i)
        eat()
      }
      expect(')')
      return { op: 'in', field: field.v, pos: field.i, vals }
    }

    // A bare field asserts that it holds a value, which makes `not deprecated` read naturally.
    if (!op || op.k !== 'op') return { op: 'truthy', field: field.v, pos: field.i }
    eat()
    return { op: 'cmp', cmp: op.v, field: field.v, pos: field.i, rhs: parseScalar() }
  }

  function parseScalar(): Scalar {
    const t = eat()
    if (!t) throw new FilterError('expected a value')
    if (t.k === 'num' || t.k === 'str') return { v: t.v }
    if (t.k === 'word') {
      const w = t.v.toLowerCase()
      if (w === 'true') return { v: true }
      if (w === 'false') return { v: false }
      if (w === 'null' || w === 'none') return { v: null }
      return { v: t.v }
    }
    throw new FilterError('expected a value', t.i)
  }

  const node = parseOr()
  if (p < tokens.length) throw new FilterError('unexpected trailing input', tokens[p]!.i)
  return node
}

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== ''
const lower = (v: unknown): string => String(v).toLowerCase()

function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b
  return lower(a) === lower(b)
}

function ordered(op: CompareOp, a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b
  }
  const x = lower(a)
  const y = lower(b)
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y
}

function build(node: Node, accessors: Record<string, Accessor>, options: FilterOptions): (m: ModelRecord) => boolean {
  const resolve = (name: string, pos: number): Accessor => {
    const accessor = accessors[name.toLowerCase()]
    if (!accessor) {
      const hint = options.suggest?.(name)
      throw new FilterError(`unknown field "${name}"${hint ? ` — did you mean "${hint}"?` : ''}`, pos)
    }
    return accessor
  }

  switch (node.op) {
    case 'and': {
      const l = build(node.l, accessors, options)
      const r = build(node.r, accessors, options)
      return (m) => l(m) && r(m)
    }
    case 'or': {
      const l = build(node.l, accessors, options)
      const r = build(node.r, accessors, options)
      return (m) => l(m) || r(m)
    }
    case 'not': {
      const r = build(node.r, accessors, options)
      return (m) => !r(m)
    }
    case 'in': {
      const get = resolve(node.field, node.pos)
      return (m) => {
        const value = get(m)
        return present(value) && node.vals.some((s) => looseEquals(value, s.v))
      }
    }
    case 'truthy': {
      const get = resolve(node.field, node.pos)
      return (m) => {
        const v = get(m)
        return v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '')
      }
    }
    case 'cmp': {
      const get = resolve(node.field, node.pos)
      const { cmp, rhs } = node
      return (m) => {
        const value = get(m)
        switch (cmp) {
          // Missing data satisfies no comparison at all — not even a negative one.
          // Otherwise `price != 0` would drag in all 249 unpriced models, and
          // `price < 1` would treat "unknown" as free. Missing data is reachable only
          // through an explicit `== null`; `not (...)` is the escape hatch for the rest.
          case '==': return rhs.v === null ? !present(value) : present(value) && looseEquals(value, rhs.v)
          case '!=': return rhs.v === null ? present(value) : present(value) && !looseEquals(value, rhs.v)
          case '~=': return present(value) && lower(value).includes(lower(rhs.v))
          case '!~': return present(value) && !lower(value).includes(lower(rhs.v))
          default: return present(value) && ordered(cmp, value, rhs.v)
        }
      }
    }
  }
}

/**
 * Compile a filter expression into a predicate. An empty expression matches everything.
 *
 * @throws {FilterError} on a malformed expression or an unknown field name.
 */
export function compileFilter(
  source: string,
  accessors: Record<string, Accessor>,
  options: FilterOptions = {},
): (m: ModelRecord) => boolean {
  if (!source || !source.trim()) return () => true
  return build(parse(lex(source)), accessors, options)
}
