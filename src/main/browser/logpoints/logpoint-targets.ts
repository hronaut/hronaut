import type { TraceMap } from '@jridgewell/trace-mapping'
import { LOGPOINT_LIMITS, type LogpointRequest } from '../../../shared/logpoint.js'
import {
  generatedPositions,
  loadSourceMap,
  scriptUrl,
  sourceMatches,
  type CdpSend,
  type LoadedSourceMap,
  type LogpointScriptRecord,
  type SourceMapBudget
} from './logpoint-sources.js'

/** A requested logpoint's script and position in the generated code. */
export interface ResolvedTarget {
  script: LogpointScriptRecord
  /** 0-based, in the generated code. */
  line: number
  column: number
  map?: TraceMap
  generatedMatches?: number
}

/** Checks one requested logpoint's shape before anything is sent to the page. */
export function validRequest(request: LogpointRequest, label: string): LogpointRequest {
  const expression = request.expression?.trim() ?? ''
  if (!expression || expression.length > LOGPOINT_LIMITS.maxExpressionChars) {
    throw new Error(`${label}: give an expression of 1 to ${LOGPOINT_LIMITS.maxExpressionChars} characters`)
  }
  if (request.url === undefined && request.source === undefined) throw new Error(`${label}: give the script's url, a source from its source map, or both`)
  if (request.url !== undefined && (!request.url || request.url.length > LOGPOINT_LIMITS.maxUrlChars)) {
    throw new Error(`${label}: url must be 1 to ${LOGPOINT_LIMITS.maxUrlChars} characters`)
  }
  if (request.source !== undefined && (!request.source || request.source.length > LOGPOINT_LIMITS.maxSourceChars)) {
    throw new Error(`${label}: source must be 1 to ${LOGPOINT_LIMITS.maxSourceChars} characters`)
  }
  if (!Number.isInteger(request.line) || request.line < 1 || request.line > LOGPOINT_LIMITS.maxLine) throw new Error(`${label}: line must be a positive integer`)
  if (request.column !== undefined && (!Number.isInteger(request.column) || request.column < 1 || request.column > LOGPOINT_LIMITS.maxColumn)) {
    throw new Error(`${label}: column must be a positive integer`)
  }
  return { ...request, expression }
}

/** The script and generated position one requested logpoint names, or an error saying why there is none. */
export async function resolveTarget(
  send: CdpSend,
  label: string,
  request: LogpointRequest,
  scripts: LogpointScriptRecord[],
  maps: Map<string, LoadedSourceMap>,
  frameId: string,
  budget: SourceMapBudget
): Promise<ResolvedTarget> {
  let candidates = scripts
  if (request.url !== undefined) {
    const url = scriptUrl(request.url) ?? request.url
    candidates = scripts.filter(script => script.url === url)
    if (!candidates.length) throw new Error(`${label}: no script of the top-level page is at that url; list them with action scripts`)
  }
  if (request.source === undefined) {
    // A document's inline scripts share its address, each on its own lines.
    const line = request.line - 1
    const onLine = candidates.filter(script => script.startLine <= line && line <= script.endLine)
    if (!onLine.length) throw new Error(`${label}: no script at that url has code on that line`)
    if (new Set(onLine.map(script => script.hash)).size > 1) {
      throw new Error(`${label}: the page runs more than one different script at that url; give a source from its source map instead`)
    }
    return { script: onLine[0]!, line, column: (request.column ?? 1) - 1 }
  }
  const matches: Array<{ script: LogpointScriptRecord; map: TraceMap; source: string }> = []
  for (const script of candidates.slice(0, LOGPOINT_LIMITS.maxScripts)) {
    if (!script.sourceMapUrl && !script.sourceMapTooLarge) continue
    let loaded = maps.get(script.scriptId)
    if (!loaded) {
      loaded = await loadSourceMap(send, frameId, script, budget)
      maps.set(script.scriptId, loaded)
    }
    if ('problem' in loaded) continue
    for (const source of loaded.sources) {
      // The same bundle loaded twice is one match.
      if (source && sourceMatches(source, request.source) && !matches.some(match => match.script.hash === script.hash && match.source === source)) {
        matches.push({ script, map: loaded.map, source })
      }
    }
  }
  if (!matches.length) throw new Error(`${label}: no source map of the top-level page that loaded lists that source; list them with action scripts`)
  const sources = [...new Set(matches.map(match => match.source))]
  if (sources.length > 1) {
    throw new Error(`${label}: ${sources.length} sources match; give a longer path, such as one of: ${sources.slice(0, 3).map(source => JSON.stringify(source.slice(0, 120))).join(', ')}`)
  }
  if (matches.length > 1) {
    throw new Error(`${label}: more than one script maps that source; add url to choose one of: ${matches.slice(0, 3).map(match => match.script.url).join(', ')}`)
  }
  const { script, map, source } = matches[0]!
  const positions = generatedPositions(map, source, request.line, request.column)
  if (!positions.length) throw new Error(`${label}: no code maps to that line of the source`)
  return { script, map, line: positions[0]!.line - 1, column: positions[0]!.column, generatedMatches: positions.length }
}
