import { LOGPOINT_LIMITS, type LogpointOriginalName } from '../../../shared/logpoint.js'
import type { RawScopes } from './logpoint-sources.js'

/**
 * ECMA-426 source map scopes, decoded only as far as logpoints need them: which original variables each generated
 * range defines, and the expression that reads each one in the generated code. Original scope positions, kinds
 * and call sites are skipped.
 */
export interface SourceMapScopes {
  /** The variables of each original scope, in the order their starts appear. */
  originalVariables: string[][]
  ranges: GeneratedRange[]
}

interface Position {
  line: number
  column: number
}

interface GeneratedRange {
  start: Position
  end: Position
  definition?: number
  /** One expression per variable of the definition, or null when the variable has no value there. */
  bindings: Array<string | null>
  /** Later expressions for a variable from a position on, in order. */
  subranges: Map<number, Array<{ from: Position; expression: string | null }>>
  children: GeneratedRange[]
}

/** The longest "scopes" string decoded, and the most items. */
const MAX_SCOPES_CHARS = 8 * 1024 * 1024
const MAX_ITEMS = 500_000
/** The longest binding expression put into an agent's expression. */
const MAX_BINDING_CHARS = 200

const TAG = { originalStart: 1, originalEnd: 2, originalVariables: 3, rangeStart: 4, rangeEnd: 5, bindings: 6, subrange: 7 } as const

const BASE64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((char, index) => [char, index]))

/** One item's unsigned VLQs; undefined when the item is not valid base64 VLQ. */
function vlqs(item: string): number[] | undefined {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const char of item) {
    const digit = BASE64.get(char)
    if (digit === undefined || shift > 30) return undefined
    value += (digit & 31) * 2 ** shift
    if (digit & 32) {
      shift += 5
      continue
    }
    values.push(value)
    value = 0
    shift = 0
  }
  return shift ? undefined : values
}

const signed = (value: number): number => (value % 2 ? -(value - 1) / 2 : value / 2)

const before = (a: Position, b: Position): boolean => a.line < b.line || (a.line === b.line && a.column < b.column)

/** Decodes a source map's "scopes" string against its "names"; undefined when it is missing, too large or malformed. */
export function decodeScopes(scopes: unknown, names: readonly string[]): SourceMapScopes | undefined {
  if (typeof scopes !== 'string' || !scopes || scopes.length > MAX_SCOPES_CHARS) return undefined
  const items = scopes.split(',')
  if (items.length > MAX_ITEMS) return undefined
  const name = (index: number): string | null => (index > 0 && index <= names.length ? names[index - 1]! : null)
  const originalVariables: string[][] = []
  const originalStack: string[][] = []
  const ranges: GeneratedRange[] = []
  const rangeStack: GeneratedRange[] = []
  let variable = 0
  let definition = 0
  const at: Position = { line: 0, column: 0 }
  const move = (lineDelta: number, column: number): Position => {
    at.column = lineDelta ? column : at.column + column
    at.line += lineDelta
    return { ...at }
  }
  for (const item of items) {
    if (!item) continue
    const values = vlqs(item)
    if (!values?.length) return undefined
    const [tag, ...fields] = values as [number, ...number[]]
    const range = rangeStack.at(-1)
    if (tag === TAG.originalStart) {
      const variables: string[] = []
      originalVariables.push(variables)
      originalStack.push(variables)
    } else if (tag === TAG.originalEnd) {
      if (!originalStack.pop()) return undefined
    } else if (tag === TAG.originalVariables) {
      const scope = originalStack.at(-1)
      if (!scope) return undefined
      for (const field of fields) {
        variable += signed(field)
        const text = names[variable]
        if (text === undefined) return undefined
        scope.push(text)
      }
    } else if (tag === TAG.rangeStart) {
      const flags = fields[0] ?? 0
      let next = 1
      const lineDelta = flags & 1 ? fields[next++] ?? 0 : 0
      const start = move(lineDelta, fields[next++] ?? 0)
      if (flags & 2) definition += signed(fields[next] ?? 0)
      const created: GeneratedRange = {
        start, end: start, ...(flags & 2 ? { definition } : {}), bindings: [], subranges: new Map(), children: []
      }
      ;(range ? range.children : ranges).push(created)
      rangeStack.push(created)
    } else if (tag === TAG.rangeEnd) {
      const closed = rangeStack.pop()
      if (!closed) return undefined
      closed.end = fields.length >= 2 ? move(fields[0]!, fields[1]!) : move(0, fields[0] ?? 0)
    } else if (tag === TAG.bindings) {
      if (!range) return undefined
      range.bindings = fields.map(name)
    } else if (tag === TAG.subrange) {
      if (!range || fields.length < 4 || (fields.length - 1) % 3) return undefined
      // The variable index is relative to the range's previous subrange item.
      const previous = [...range.subranges.keys()].at(-1) ?? 0
      const index = previous + fields[0]!
      const list = range.subranges.get(index) ?? []
      let from = list.at(-1)?.from ?? range.start
      for (let field = 1; field < fields.length; field += 3) {
        const lineDelta = fields[field + 1]!
        from = { line: from.line + lineDelta, column: lineDelta ? fields[field + 2]! : from.column + fields[field + 2]! }
        list.push({ from, expression: name(fields[field]!) })
      }
      range.subranges.set(index, list)
    }
    // Call sites and items of tags this version does not know are skipped.
  }
  return rangeStack.length || originalStack.length ? undefined : { originalVariables, ranges }
}

/**
 * The original variables in scope at a generated position (0-based line and column), each with the expression that
 * reads it there, or null when the source map says it has no value there. An inner range's variables hide outer ones.
 */
export function originalBindings(scopes: SourceMapScopes, line: number, column: number): Map<string, string | null> {
  const position = { line, column }
  const bindings = new Map<string, string | null>()
  let level = scopes.ranges
  for (;;) {
    const range = level.find(candidate => !before(position, candidate.start) && before(position, candidate.end))
    if (!range) return bindings
    const variables = range.definition === undefined ? undefined : scopes.originalVariables[range.definition]
    for (const [index, variable] of (variables ?? []).entries()) {
      let expression = range.bindings[index] ?? null
      for (const subrange of range.subranges.get(index) ?? []) if (!before(position, subrange.from)) expression = subrange.expression
      bindings.set(variable, expression)
    }
    level = range.children
  }
}

type TokenKind = 'name' | 'private' | 'number' | 'string' | 'template' | 'regex' | 'punctuator'

interface Token {
  kind: TokenKind
  text: string
  start: number
}

/** Keywords after which a slash starts a regular expression rather than dividing. */
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await'])
const NAME_START = /[\p{ID_Start}$_\\]/u
const NAME_PART = /[\p{ID_Continue}$\\‌‍]/u

/**
 * Splits an expression into tokens, skipping white space and comments, closely enough to tell names from property
 * names, strings, templates and regular expressions. A template's substitutions are tokenized like code.
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  // For each open brace: whether it opened a template substitution.
  const braces: boolean[] = []
  let index = 0
  const regexAllowed = (): boolean => {
    const last = tokens.at(-1)
    if (!last) return true
    if (last.kind === 'name') return REGEX_AFTER.has(last.text)
    if (last.kind === 'punctuator') return ![')', ']', '}'].includes(last.text)
    return false
  }
  const templatePart = (start: number): void => {
    // Reads a template from just after a backtick or a substitution's closing brace.
    while (index < source.length) {
      const char = source[index]!
      if (char === '\\') index += 2
      else if (char === '`') {
        index++
        break
      } else if (char === '$' && source[index + 1] === '{') {
        index += 2
        braces.push(true)
        break
      } else index++
    }
    tokens.push({ kind: 'template', text: source.slice(start, index), start })
  }
  while (index < source.length) {
    const start = index
    const char = source[index]!
    if (/\s/u.test(char)) index++
    else if (source.startsWith('//', index)) index = source.includes('\n', index) ? source.indexOf('\n', index) : source.length
    else if (source.startsWith('/*', index)) index = source.includes('*/', index + 2) ? source.indexOf('*/', index + 2) + 2 : source.length
    else if (char === '"' || char === '\'') {
      index++
      while (index < source.length && source[index] !== char) index += source[index] === '\\' ? 2 : 1
      index++
      tokens.push({ kind: 'string', text: source.slice(start, index), start })
    } else if (char === '`') {
      index++
      templatePart(start)
    } else if (char === '}' && braces.at(-1) === true) {
      braces.pop()
      index++
      templatePart(start)
    } else if (char === '#' || NAME_START.test(char)) {
      index++
      while (index < source.length && NAME_PART.test(source[index]!)) index++
      tokens.push({ kind: char === '#' ? 'private' : 'name', text: source.slice(start, index), start })
    } else if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      index++
      while (index < source.length && /[\w.]/.test(source[index]!)) index++
      tokens.push({ kind: 'number', text: source.slice(start, index), start })
    } else if (char === '/' && regexAllowed()) {
      index++
      let inClass = false
      while (index < source.length && (inClass || source[index] !== '/')) {
        if (source[index] === '\\') index++
        else if (source[index] === '[') inClass = true
        else if (source[index] === ']') inClass = false
        index++
      }
      index++
      while (index < source.length && /\w/.test(source[index]!)) index++
      tokens.push({ kind: 'regex', text: source.slice(start, index), start })
    } else {
      const text = source.startsWith('?.', index) && !/\d/.test(source[index + 2] ?? '') ? '?.'
        : source.startsWith('=>', index) ? '=>'
          : source.startsWith('...', index) ? '...' : char
      index += text.length
      if (text === '{') braces.push(false)
      else if (text === '}') braces.pop()
      tokens.push({ kind: 'punctuator', text, start })
    }
  }
  return tokens
}

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

/**
 * Replaces the original variable names an expression reads with the generated code's expressions for them. Property
 * names, object keys, strings and comments are left alone; a shorthand property keeps its key. Throws when the
 * expression reads a variable the source map says has no value at that location.
 */
export function rewriteOriginalNames(expression: string, bindings: ReadonlyMap<string, string | null>, label: string): {
  expression: string
  originalNames: LogpointOriginalName[]
} {
  const tokens = tokenize(expression)
  const originalNames = new Map<string, string>()
  // For each open brace: whether it opened an object literal rather than a block.
  const objects: boolean[] = []
  let output = ''
  let copied = 0
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1]
    const next = tokens[index + 1]
    if (token.kind === 'punctuator' && token.text === '{') objects.push(!previous || !['=>', ')'].includes(previous.text))
    if (token.kind === 'punctuator' && token.text === '}') objects.pop()
    if (token.kind !== 'name' || !bindings.has(token.text)) continue
    if (previous?.kind === 'punctuator' && (previous.text === '.' || previous.text === '?.')) continue
    const afterKeyStart = previous?.kind === 'punctuator' && (previous.text === '{' || previous.text === ',')
    if (afterKeyStart && objects.at(-1) && next?.text === ':') continue
    const generated = bindings.get(token.text)
    if (generated === null || generated === undefined) {
      throw new Error(`${label}: the source map says ${token.text} has no value at that location, as when a bundler removed it`)
    }
    if (generated.length > MAX_BINDING_CHARS) {
      throw new Error(`${label}: the source map reads ${token.text} through an expression over ${MAX_BINDING_CHARS} characters`)
    }
    if (generated === token.text) continue
    originalNames.set(token.text, generated)
    const replacement = IDENTIFIER.test(generated) ? generated : `(${generated})`
    const shorthand = afterKeyStart && objects.at(-1) && (next?.text === ',' || next?.text === '}')
    output += expression.slice(copied, token.start) + (shorthand ? `${token.text}: ${replacement}` : replacement)
    copied = token.start + token.text.length
  }
  const rewritten = output + expression.slice(copied)
  if (rewritten.length > LOGPOINT_LIMITS.maxExpressionChars * 4) throw new Error(`${label}: the expression is too long once its original names are replaced`)
  return { expression: rewritten, originalNames: [...originalNames].map(([name, generated]) => ({ name, generated })) }
}

const decoded = new WeakMap<RawScopes, SourceMapScopes | null>()

/**
 * For a logpoint whose source map has scopes: the expression to evaluate at a generated position (0-based), with
 * original variable names replaced, and which names were. Nothing when there are no scopes or nothing to replace.
 */
export function withOriginalNames(label: string, expression: string, scopes: RawScopes | undefined, line: number, column: number): {
  evaluated?: string
  originalNames?: LogpointOriginalName[]
} {
  if (!scopes) return {}
  if (!decoded.has(scopes)) decoded.set(scopes, decodeScopes(scopes.scopes, scopes.names) ?? null)
  const map = decoded.get(scopes)
  if (!map) return {}
  const result = rewriteOriginalNames(expression, originalBindings(map, line, column), label)
  return result.originalNames.length ? { evaluated: result.expression, originalNames: result.originalNames } : {}
}
