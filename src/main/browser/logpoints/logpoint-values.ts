import { LOGPOINT_LIMITS, type LogpointRecord, type LogpointValue } from '../../../shared/logpoint.js'

interface RemoteObjectPreview {
  overflow?: boolean
  properties?: Array<{ name?: unknown; type?: unknown; subtype?: unknown; value?: unknown }>
}

export interface RemoteObject {
  type?: unknown
  subtype?: unknown
  value?: unknown
  unserializableValue?: unknown
  description?: unknown
  preview?: RemoteObjectPreview
}

export interface EvaluationResult {
  result?: RemoteObject
  exceptionDetails?: { text?: unknown; exception?: RemoteObject }
}

const SIDE_EFFECT = /possible side-effect in debug-evaluate/i
const TERMINATED = /execution was terminated/i

function cut(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0]!
}

/**
 * The expression as Hronaut evaluates it at a hit. A string longer than maxTextChars comes back cut,
 * after the marker and its full length, so a page's long string is never copied whole. The marker is
 * random for each set of logpoints and never reaches the page, so no page string can pose as a cut one.
 */
export function wrappedExpression(expression: string, marker: string): string {
  const max = LOGPOINT_LIMITS.maxTextChars
  // The expression stands on its own lines, so a trailing line comment cannot swallow the closing parentheses.
  return `(value => typeof value === 'string' && value.length > ${max} ? ${JSON.stringify(marker)} + value.length + ':' + value.slice(0, ${max}) : value)((\n${expression}\n))`
}

function stringValue(raw: string, marker: string): LogpointValue {
  const max = LOGPOINT_LIMITS.maxTextChars
  if (raw.startsWith(marker)) {
    const rest = raw.slice(marker.length)
    const colon = rest.indexOf(':')
    const chars = Number(rest.slice(0, colon))
    if (colon > 0 && Number.isSafeInteger(chars)) return { type: 'string', value: rest.slice(colon + 1, colon + 1 + max), chars }
  }
  return raw.length > max ? { type: 'string', value: raw.slice(0, max), chars: raw.length } : { type: 'string', value: raw }
}

function objectValue(remote: RemoteObject): LogpointValue {
  const subtype = typeof remote.subtype === 'string' ? cut(remote.subtype, 20) : undefined
  if (subtype === 'null') return { type: 'object', subtype }
  const raw = typeof remote.description === 'string' ? remote.description : ''
  // An error's description carries its stack; only its first line, the name and message, is kept.
  const description = cut(subtype === 'error' ? firstLine(raw) : raw, LOGPOINT_LIMITS.maxDescriptionChars)
  const previewed = remote.preview?.properties ?? []
  const properties = previewed.slice(0, LOGPOINT_LIMITS.maxPreviewProperties).map(property => {
    const type = typeof property.type === 'string' ? cut(property.type, 20) : 'undefined'
    return {
      name: cut(typeof property.name === 'string' ? property.name : '', LOGPOINT_LIMITS.maxPropertyNameChars),
      type,
      ...(typeof property.subtype === 'string' ? { subtype: cut(property.subtype, 20) } : {}),
      // A function's preview value is never its source, and is left out like the function itself.
      ...(type !== 'function' && typeof property.value === 'string' ? { value: cut(property.value, LOGPOINT_LIMITS.maxPropertyValueChars) } : {})
    }
  })
  return {
    type: 'object',
    ...(subtype ? { subtype } : {}),
    ...(description ? { description } : {}),
    ...(properties.length ? { properties } : {}),
    ...(remote.preview?.overflow === true || previewed.length > properties.length ? { overflow: true } : {})
  }
}

/** A value as a logpoint record keeps it: bounded, and never a function's source. */
export function projectValue(remote: RemoteObject, marker: string): LogpointValue {
  const type = typeof remote.type === 'string' ? remote.type : 'undefined'
  const special = typeof remote.unserializableValue === 'string' ? remote.unserializableValue
    : typeof remote.description === 'string' ? remote.description : ''
  switch (type) {
    case 'undefined':
      return { type }
    case 'boolean':
      return typeof remote.value === 'boolean' ? { type, value: remote.value } : { type }
    case 'number':
      return typeof remote.value === 'number' ? { type, value: remote.value } : { type, value: cut(special, 40) }
    case 'bigint':
      return { type, value: cut(special, LOGPOINT_LIMITS.maxTextChars) }
    case 'symbol':
      return { type, value: cut(firstLine(special), LOGPOINT_LIMITS.maxDescriptionChars) }
    case 'string':
      return stringValue(typeof remote.value === 'string' ? remote.value : '', marker)
    case 'function':
      // Chromium describes a function by its source text.
      return { type }
    case 'object':
      return objectValue(remote)
    default:
      return { type: cut(type, 20) }
  }
}

/** The record of one hit's evaluation: its value, or why there is none. */
export function evaluationRecord(result: EvaluationResult, marker: string, at: string): LogpointRecord {
  const exception = result.exceptionDetails
  if (exception) {
    const description = typeof exception.exception?.description === 'string' ? exception.exception.description
      : typeof exception.text === 'string' ? exception.text : ''
    if (SIDE_EFFECT.test(description)) return { at, error: { kind: 'side-effect' } }
    if (TERMINATED.test(description)) return { at, error: { kind: 'timeout' } }
    // A thrown function is described by its source, which is never kept.
    if (exception.exception?.type === 'function') return { at, error: { kind: 'exception' } }
    return { at, error: { kind: 'exception', message: cut(firstLine(description), LOGPOINT_LIMITS.maxMessageChars) } }
  }
  return { at, value: projectValue(result.result ?? {}, marker) }
}

/** The record of a hit whose evaluation did not answer: Chromium stopped it at its deadline, or the frame was gone. */
export function failedEvaluationRecord(error: unknown, at: string): LogpointRecord {
  return { at, error: { kind: TERMINATED.test(String(error)) ? 'timeout' : 'unavailable' } }
}
