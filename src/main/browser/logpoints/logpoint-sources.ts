import type { Session } from 'electron'
import { AnyMap, LEAST_UPPER_BOUND, allGeneratedPositionsFor, originalPositionFor, type TraceMap } from '@jridgewell/trace-mapping'
import {
  LOGPOINT_LIMITS,
  type LogpointOriginalLocation,
  type LogpointScript,
  type LogpointSourceMapProblem
} from '../../../shared/logpoint.js'

/** A script as the Debugger domain reported it. */
export interface LogpointScriptRecord {
  scriptId: string
  /** The script's HTTP(S) address as origin and path, or undefined for evaluated and other scripts. */
  url?: string
  /** The address as Chromium reported it, up to 4,096 characters, to resolve a relative source map address; never returned. */
  rawUrl: string
  hash: string
  executionContextId: number
  /**
   * The frame Chromium reported the script for. A script compiled before the Debugger domain was enabled
   * can be shared by same-origin frames of the page, and is then reported for only one of them.
   */
  frameId?: string
  /** The script's first and last line in its resource, 0-based: an inline script starts inside its document. */
  startLine: number
  endLine: number
  /** Whether the script runs in its frame's own JavaScript context, not an isolated world such as Hronaut's. */
  isDefault: boolean
  sourceMapUrl?: string
  /** The script named a source map address, inline map included, too long to be one Hronaut reads. */
  sourceMapTooLarge?: boolean
}

export type CdpSend = <R>(method: string, params?: Record<string, unknown>) => Promise<R>

/** A loaded map, with its ECMA-426 "scopes" string and "names" when it has them, decoded only when a logpoint uses them. */
export type LoadedSourceMap = { map: TraceMap; sources: string[]; scopes?: RawScopes } | { problem: LogpointSourceMapProblem }

export interface RawScopes {
  scopes: string
  names: string[]
}

/** What one call may still read of source maps, in bytes and time. */
export interface SourceMapBudget {
  remainingBytes: number
  deadline: number
}

/** How long one call may spend reading source maps. */
const SOURCE_MAP_CALL_MS = 10_000

/** A new call's source map budget. */
export function sourceMapBudget(): SourceMapBudget {
  return { remainingBytes: LOGPOINT_LIMITS.maxSourceMapTotalBytes, deadline: performance.now() + SOURCE_MAP_CALL_MS }
}

interface ScriptParsedEvent {
  scriptId?: unknown
  url?: unknown
  hash?: unknown
  executionContextId?: unknown
  startLine?: unknown
  endLine?: unknown
  sourceMapURL?: unknown
  executionContextAuxData?: { isDefault?: unknown; frameId?: unknown }
}

// Control, formatting and line-separator characters, which a source name could use to break or disguise text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g
/** The longest address kept to resolve a source map against; a longer one keeps only its origin and path. */
const MAX_RAW_URL_CHARS = 4_096
/** The longest source map address kept: an inline map of maxSourceMapBytes in base64, with its prefix. */
const MAX_SOURCE_MAP_URL_CHARS = Math.ceil(LOGPOINT_LIMITS.maxSourceMapBytes * 4 / 3) + 1_024
/** The prefix a server may put before JSON to stop it running as a script. */
const XSSI_PREFIX = /^\)\]\}'[^\n]*\n/

function bounded(text: string, maxChars: number): string {
  const clean = text.replace(CONTROL_CHARACTERS, '')
  return clean.length > maxChars ? `${clean.slice(0, maxChars - 1)}…` : clean
}

/** An HTTP(S) script's origin and path, without credentials, query or fragment, or undefined for any other script. */
export function scriptUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const url = `${parsed.origin}${parsed.pathname}`
  return url.length > LOGPOINT_LIMITS.maxUrlChars ? undefined : url
}

export function scriptRecord(params: unknown): LogpointScriptRecord | undefined {
  const event = params as ScriptParsedEvent
  if (typeof event?.scriptId !== 'string' || typeof event.hash !== 'string' || typeof event.executionContextId !== 'number') return undefined
  const raw = typeof event.url === 'string' ? event.url : ''
  const url = scriptUrl(raw)
  const frameId = event.executionContextAuxData?.frameId
  const sourceMapUrl = typeof event.sourceMapURL === 'string' ? event.sourceMapURL : ''
  return {
    scriptId: event.scriptId,
    url,
    // Kept for up to thousands of scripts while armed, so a page cannot make them hold unbounded text.
    rawUrl: raw.length <= MAX_RAW_URL_CHARS ? raw : url ?? '',
    hash: event.hash,
    executionContextId: event.executionContextId,
    ...(typeof frameId === 'string' ? { frameId } : {}),
    startLine: typeof event.startLine === 'number' ? event.startLine : 0,
    endLine: typeof event.endLine === 'number' ? event.endLine : Number.MAX_SAFE_INTEGER,
    isDefault: event.executionContextAuxData?.isDefault === true,
    ...(sourceMapUrl.length > MAX_SOURCE_MAP_URL_CHARS ? { sourceMapTooLarge: true } : sourceMapUrl ? { sourceMapUrl } : {})
  }
}

/** Scripts that run in the page's own JavaScript context of one of the frames, with or without an HTTP(S) address. */
export function frameScripts(scripts: Iterable<LogpointScriptRecord>, frames: ReadonlySet<string>): LogpointScriptRecord[] {
  return [...scripts].filter(script => script.isDefault && script.frameId !== undefined && frames.has(script.frameId))
}

/** The HTTP(S) scripts of the frames, one for each address and content, sorted by address and then as Chromium compiled them. */
export function documentScripts(scripts: Iterable<LogpointScriptRecord>, frames: ReadonlySet<string>): LogpointScriptRecord[] {
  const seen = new Set<string>()
  return frameScripts(scripts, frames)
    .filter(script => script.url !== undefined)
    .sort((a, b) => (a.url! < b.url! ? -1 : a.url! > b.url! ? 1 : 0) || Number(a.scriptId) - Number(b.scriptId))
    .filter(script => {
      const key = `${script.url}\n${script.hash}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** An inline map's text, counted against the call's budget like a fetched one. */
function dataUrlText(url: string, budget: SourceMapBudget): string | LogpointSourceMapProblem {
  const comma = url.indexOf(',')
  if (comma < 0) return 'invalid'
  const meta = url.slice('data:'.length, comma).toLowerCase().split(';').map(part => part.trim())
  if (meta[0] !== 'application/json' && meta[0] !== '') return 'unsupported-url'
  const payload = url.slice(comma + 1)
  const limit = Math.min(LOGPOINT_LIMITS.maxSourceMapBytes, budget.remainingBytes)
  // Base64 holds three bytes in four characters; a percent-encoded byte takes up to three.
  if (payload.length > limit * (meta.includes('base64') ? 4 / 3 : 3)) return 'too-large'
  try {
    const text = meta.includes('base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload)
    const bytes = Buffer.byteLength(text)
    budget.remainingBytes -= Math.min(bytes, budget.remainingBytes)
    return bytes > limit ? 'too-large' : text
  } catch {
    return 'invalid'
  }
}

/** Fetches a source map address; the tab's session in the app, a stand-in in tests. */
export type MapFetch = (url: string, signal: AbortSignal) => Promise<Response>

/**
 * Fetches through the tab's session, so its proxy and certificate rules apply, with credentials omitted on the
 * request and every redirect: the address is the page's choice. CDP's Network.loadNetworkResource is not used, as it
 * sends the page's cookies to its own origin even with includeCredentials false.
 */
export function sessionMapFetch(session: Pick<Session, 'fetch'>): MapFetch {
  return async (url, signal) => await session.fetch(url, { credentials: 'omit', signal })
}

/** Reads a map without cookies, so a map that needs a sign-in is unavailable; bounded in bytes and time. */
async function fetchText(fetchMap: MapFetch, url: string, budget: SourceMapBudget): Promise<string | LogpointSourceMapProblem> {
  const remaining = Math.min(budget.deadline, performance.now() + LOGPOINT_LIMITS.sourceMapTimeoutMs) - performance.now()
  if (remaining <= 0) return 'timeout'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), remaining)
  const limit = Math.min(LOGPOINT_LIMITS.maxSourceMapBytes, budget.remainingBytes)
  let bytes = 0
  try {
    const response = await fetchMap(url, controller.signal)
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return 'fetch-failed'
    }
    const reader = response.body?.getReader()
    if (!reader) return ''
    const chunks: Buffer[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined)
        return 'too-large'
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return controller.signal.aborted ? 'timeout' : 'fetch-failed'
  } finally {
    clearTimeout(timer)
    budget.remainingBytes -= Math.min(bytes, budget.remainingBytes)
  }
}

function parseSourceMap(text: string): { map: TraceMap; scopes?: RawScopes } | undefined {
  try {
    const raw: unknown = JSON.parse(text.replace(XSSI_PREFIX, ''))
    if (!raw || typeof raw !== 'object') return undefined
    const map = new AnyMap(raw as ConstructorParameters<typeof AnyMap>[0])
    // Scopes are read from a plain map only, not an index map's sections.
    const { scopes, names } = raw as { scopes?: unknown; names?: unknown }
    const nameList = Array.isArray(names) ? names.map(name => (typeof name === 'string' ? name : '')) : []
    return { map, ...(typeof scopes === 'string' && scopes ? { scopes: { scopes, names: nameList } } : {}) }
  } catch {
    return undefined
  }
}

/** The sources a source map lists, with its sourceRoot applied, never their contents. */
function mapSources(map: TraceMap): string[] {
  return map.resolvedSources.map((source, index) => source || map.sources[index] || '')
}

/**
 * Reads one script's source map: an inline data: map, or an HTTP(S) one through the tab's session without
 * cookies. Bounded in size and time for the whole call; never throws.
 */
export async function loadSourceMap(fetchMap: MapFetch, script: LogpointScriptRecord, budget: SourceMapBudget): Promise<LoadedSourceMap> {
  if (script.sourceMapTooLarge) return { problem: 'too-large' }
  if (!script.sourceMapUrl) return { problem: 'fetch-failed' }
  if (budget.remainingBytes <= 0) return { problem: 'too-large' }
  if (performance.now() >= budget.deadline) return { problem: 'timeout' }
  let text: string | LogpointSourceMapProblem
  if (script.sourceMapUrl.startsWith('data:')) {
    text = dataUrlText(script.sourceMapUrl, budget)
  } else {
    let url: URL
    try {
      url = new URL(script.sourceMapUrl, script.rawUrl)
    } catch {
      return { problem: 'unsupported-url' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { problem: 'unsupported-url' }
    text = await fetchText(fetchMap, url.href, budget)
  }
  if (text === 'invalid' || text === 'too-large' || text === 'timeout' || text === 'fetch-failed' || text === 'unsupported-url') return { problem: text }
  const parsed = parseSourceMap(text)
  return parsed ? { ...parsed, sources: mapSources(parsed.map) } : { problem: 'invalid' }
}

/** One script as scripts reports it: its address and, when its source map loaded, the sources it lists. */
export function describeScript(script: LogpointScriptRecord, loaded: LoadedSourceMap | 'not-checked' | undefined): LogpointScript {
  const url = script.url ?? ''
  if (script.sourceMapTooLarge) return { url, sourceMap: 'unavailable', sourceMapProblem: 'too-large' }
  if (!script.sourceMapUrl) return { url, sourceMap: 'none' }
  if (loaded === undefined || loaded === 'not-checked') return { url, sourceMap: 'not-checked' }
  if ('problem' in loaded) return { url, sourceMap: 'unavailable', sourceMapProblem: loaded.problem }
  const sources = loaded.sources.filter(Boolean)
  return {
    url,
    sourceMap: 'loaded',
    sources: sources.slice(0, LOGPOINT_LIMITS.maxSourcesPerScript).map(source => bounded(source, LOGPOINT_LIMITS.maxSourceChars)),
    ...(sources.length > LOGPOINT_LIMITS.maxSourcesPerScript ? { sourcesTruncated: true } : {})
  }
}

/** A path's segments without a scheme and host such as webpack://app, a query or fragment, or "." segments. */
function pathSegments(path: string): string[] {
  const withoutHost = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  return withoutHost.split(/[?#]/, 1)[0]!.split(/[\\/]+/).filter(segment => segment && segment !== '.')
}

/** Whether a source map's source is the requested one: the same text, or ending in the requested path's segments. */
export function sourceMatches(candidate: string, requested: string): boolean {
  if (candidate === requested) return true
  const wanted = pathSegments(requested)
  const have = pathSegments(candidate)
  if (!wanted.length || wanted.length > have.length) return false
  const offset = have.length - wanted.length
  return wanted.every((segment, index) => segment === have[offset + index])
}

/**
 * The generated positions (1-based line, 0-based column) that a source line maps to, first in the
 * generated code first, keeping only those that map back to that same source line.
 */
export function generatedPositions(map: TraceMap, source: string, line: number, column?: number): Array<{ line: number; column: number }> {
  const positions = allGeneratedPositionsFor(map, column === undefined
    ? { source, line, column: 0 }
    : { source, line, column: column - 1, bias: LEAST_UPPER_BOUND })
  return positions
    .filter((position): position is { line: number; column: number } => typeof position.line === 'number' && typeof position.column === 'number')
    .filter(position => {
      const original = originalPositionFor(map, position)
      return original.line === line && original.source !== null && sourceMatches(original.source, source)
    })
    .sort((a, b) => a.line - b.line || a.column - b.column)
}

/** Where a generated position (1-based line, 0-based column) maps to in the source, with a 1-based column. */
export function originalLocation(map: TraceMap, line: number, column: number): LogpointOriginalLocation | undefined {
  const original = originalPositionFor(map, { line, column })
  if (original.source === null || original.line === null || original.column === null) return undefined
  return { source: bounded(original.source, LOGPOINT_LIMITS.maxSourceChars), line: original.line, column: original.column + 1 }
}
