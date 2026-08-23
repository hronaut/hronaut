import { redactDiagnosticText } from './debug-report.js'
import type { BrowserServerTimingMetric } from './types.js'

export const MAX_SERVER_TIMING_METRICS = 32
const MAX_SERVER_TIMING_NAME_CHARS = 128
const MAX_SERVER_TIMING_DESCRIPTION_CHARS = 256
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function splitOutsideQuotes(value: string, delimiter: ',' | ';'): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false
  let escaped = false
  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (quoted && character === '\\') {
      current += character
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      current += character
      continue
    }
    if (!quoted && character === delimiter) {
      values.push(current)
      current = ''
      continue
    }
    current += character
  }
  values.push(current)
  return values
}

function parameterValue(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"')) {
    let result = ''
    let escaped = false
    for (const character of value.slice(1)) {
      if (escaped) {
        result += character
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        return result
      } else {
        result += character
      }
    }
    return result
  }
  return value
}

function parseMetric(value: string): BrowserServerTimingMetric | undefined {
  const [rawName, ...rawParameters] = splitOutsideQuotes(value, ';')
  const name = rawName?.trim() ?? ''
  if (!name || name.length > MAX_SERVER_TIMING_NAME_CHARS || !HTTP_TOKEN.test(name)) return undefined

  let durationMs: number | undefined
  let description: string | undefined
  let durationSeen = false
  let descriptionSeen = false
  for (const rawParameter of rawParameters) {
    const separator = rawParameter.indexOf('=')
    if (separator < 1) continue
    const parameterName = rawParameter.slice(0, separator).trim().toLowerCase()
    const value = parameterValue(rawParameter.slice(separator + 1))
    if (parameterName === 'dur' && !durationSeen) {
      durationSeen = true
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) durationMs = Math.round(parsed * 10) / 10
    } else if (parameterName === 'desc' && !descriptionSeen) {
      descriptionSeen = true
      const sanitized = redactDiagnosticText(value)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, MAX_SERVER_TIMING_DESCRIPTION_CHARS)
      if (sanitized) description = sanitized
    }
  }

  return {
    name,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(description ? { description } : {})
  }
}

export function parseServerTimingHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): BrowserServerTimingMetric[] {
  const values = Object.entries(headers ?? {})
    .filter(([name]) => name.toLowerCase() === 'server-timing')
    .flatMap(([, value]) => value === undefined ? [] : Array.isArray(value) ? value : [value])
  const metrics: BrowserServerTimingMetric[] = []
  for (const value of values) {
    for (const rawMetric of splitOutsideQuotes(value, ',')) {
      const metric = parseMetric(rawMetric)
      if (!metric) continue
      metrics.push(metric)
      if (metrics.length >= MAX_SERVER_TIMING_METRICS) return metrics
    }
  }
  return metrics
}

export function serializeServerTimingMetrics(metrics: BrowserServerTimingMetric[]): string {
  return metrics.map((metric) => {
    const parameters: string[] = []
    if (metric.durationMs !== undefined) parameters.push(`dur=${metric.durationMs}`)
    if (metric.description) {
      const description = metric.description.replace(/(["\\])/g, '\\$1')
      parameters.push(`desc="${description}"`)
    }
    return [metric.name, ...parameters].join(';')
  }).join(', ')
}
