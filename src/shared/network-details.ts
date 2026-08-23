const REDACTED_VALUE = '[REDACTED]'

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

function redactJsonValue(value: unknown): { value: unknown; redacted: boolean } {
  if (Array.isArray(value)) {
    let redacted = false
    const next = value.map((item) => {
      const result = redactJsonValue(item)
      redacted ||= result.redacted
      return result.value
    })
    return { value: next, redacted }
  }
  if (!value || typeof value !== 'object') return { value, redacted: false }
  let redacted = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveName(key)) {
      next[key] = REDACTED_VALUE
      redacted = true
      continue
    }
    const result = redactJsonValue(item)
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
  const safe: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue
    safe[name] = isSensitiveName(name)
      ? REDACTED_VALUE
      : Array.isArray(value) ? [...value] : value
  }
  return safe
}

export function redactNetworkUrl(input: string): string {
  try {
    const url = new URL(input)
    if (url.username) url.username = REDACTED_VALUE
    if (url.password) url.password = REDACTED_VALUE
    for (const key of [...url.searchParams.keys()]) {
      if (!isSensitiveName(key)) continue
      const values = url.searchParams.getAll(key)
      url.searchParams.delete(key)
      for (let index = 0; index < values.length; index += 1) url.searchParams.append(key, REDACTED_VALUE)
    }
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
      const result = redactJsonValue(JSON.parse(body))
      return boundBody(JSON.stringify(result.value, null, 2), originalChars, maxChars, result.redacted)
    } catch {
      // A mislabeled or incomplete JSON response is still useful as bounded text.
    }
  }
  if (FORM_CONTENT_TYPE.test(normalizedType)) {
    const form = new URLSearchParams(body)
    let redacted = false
    for (const key of [...form.keys()]) {
      if (!isSensitiveName(key)) continue
      const values = form.getAll(key)
      form.delete(key)
      for (let index = 0; index < values.length; index += 1) form.append(key, REDACTED_VALUE)
      redacted = true
    }
    return boundBody(form.toString(), originalChars, maxChars, redacted)
  }
  if (normalizedType && !TEXT_CONTENT_TYPE.test(normalizedType)) {
    return boundBody('[non-text body omitted]', originalChars, maxChars, true)
  }
  return boundBody(body, originalChars, maxChars, false)
}
