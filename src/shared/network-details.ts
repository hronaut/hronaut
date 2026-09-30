const REDACTED_VALUE = '[REDACTED]'
const MAX_JSON_REDACTION_DEPTH = 100

const SENSITIVE_NAME = /(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|secret|session|token)/i
const JSON_CONTENT_TYPE = /(?:^|[+/])json(?:;|$)/i
const FORM_CONTENT_TYPE = /^application\/x-www-form-urlencoded(?:;|$)/i
const MULTIPART_CONTENT_TYPE = /^multipart\//i
const TEXT_CONTENT_TYPE = /^(?:text\/[^;]+|application\/(?:javascript|graphql|xml|xhtml\+xml))(?:;|$)/i

export interface SanitizedNetworkBody {
  text: string
  originalChars: number
  truncated: boolean
  redacted: boolean
}

function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name)
}

function redactJsonValue(value: unknown, depth = 0): { value: unknown; redacted: boolean } {
  if (value && typeof value === 'object' && depth > MAX_JSON_REDACTION_DEPTH) {
    throw new Error('JSON nesting exceeds the safe redaction limit')
  }
  if (Array.isArray(value)) {
    let redacted = false
    const next = value.map((item) => {
      const result = redactJsonValue(item, depth + 1)
      redacted ||= result.redacted
      return result.value
    })
    return { value: next, redacted }
  }
  if (!value || typeof value !== 'object') return { value, redacted: false }
  let redacted = false
  const next = Object.create(null) as Record<string, unknown>
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveName(key)) {
      next[key] = REDACTED_VALUE
      redacted = true
      continue
    }
    const result = redactJsonValue(item, depth + 1)
    next[key] = result.value
    redacted ||= result.redacted
  }
  return { value: next, redacted }
}

function boundBody(text: string, originalChars: number, maxChars: number, redacted: boolean): SanitizedNetworkBody {
  if (text.length <= maxChars) return { text, originalChars, truncated: false, redacted }
  return {
    text: `${text.slice(0, maxChars)}\n[truncated after ${maxChars} characters]`,
    originalChars,
    truncated: true,
    redacted
  }
}

export function redactNetworkHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): Record<string, string | string[]> {
  const safe = Object.create(null) as Record<string, string | string[]>
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue
    safe[name] = isSensitiveName(name)
      ? REDACTED_VALUE
      : Array.isArray(value) ? [...value] : value
  }
  return safe
}

function redactParameters(parameters: URLSearchParams): URLSearchParams | undefined {
  const visible: Array<[string, string]> = []
  const sensitive = new Map<string, number>()
  for (const [name, value] of parameters) {
    if (!isSensitiveName(name)) {
      visible.push([name, value])
      continue
    }
    const count = (sensitive.get(name) ?? 0) + 1
    // Preserve the previous output order: each sensitive group moves to the
    // end at its last occurrence, without repeatedly rewriting all its values.
    sensitive.delete(name)
    sensitive.set(name, count)
  }
  if (!sensitive.size) return undefined
  const redacted = new URLSearchParams(visible)
  for (const [name, count] of sensitive) {
    for (let index = 0; index < count; index += 1) redacted.append(name, REDACTED_VALUE)
  }
  return redacted
}

export function redactNetworkUrl(input: string): string {
  try {
    const url = new URL(input)
    if (url.username) url.username = REDACTED_VALUE
    if (url.password) url.password = REDACTED_VALUE
    const redacted = redactParameters(url.searchParams)
    if (redacted) url.search = redacted.toString()
    url.hash = ''
    return url.href
  } catch {
    return input
  }
}

export function sanitizeNetworkBody(
  body: string,
  contentType: string | undefined,
  maxChars: number,
  options: { base64Encoded?: boolean } = {}
): SanitizedNetworkBody {
  const originalChars = body.length
  const normalizedType = contentType?.trim() ?? ''
  if (options.base64Encoded) {
    return boundBody('[binary body omitted]', originalChars, maxChars, true)
  }
  if (!body) return { text: '', originalChars: 0, truncated: false, redacted: false }
  if (MULTIPART_CONTENT_TYPE.test(normalizedType)) {
    return boundBody('[multipart body omitted]', originalChars, maxChars, true)
  }
  if (JSON_CONTENT_TYPE.test(normalizedType) || /^[\s\r\n]*[\[{]/.test(body)) {
    try {
      const parsed: unknown = JSON.parse(body)
      try {
        const result = redactJsonValue(parsed)
        return boundBody(JSON.stringify(result.value, null, 2), originalChars, maxChars, result.redacted)
      } catch {
        // Valid JSON must never fall back to raw text if secret redaction fails.
        return boundBody('[JSON body omitted: could not safely redact]', originalChars, maxChars, true)
      }
    } catch {
      // A mislabeled or incomplete JSON response is still useful as bounded text.
    }
  }
  if (FORM_CONTENT_TYPE.test(normalizedType)) {
    const form = new URLSearchParams(body)
    const redacted = redactParameters(form)
    return boundBody((redacted ?? form).toString(), originalChars, maxChars, Boolean(redacted))
  }
  if (normalizedType && !TEXT_CONTENT_TYPE.test(normalizedType)) {
    return boundBody('[non-text body omitted]', originalChars, maxChars, true)
  }
  return boundBody(body, originalChars, maxChars, false)
}
