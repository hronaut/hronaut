import { NETWORK_BODY_PLACEHOLDERS } from './network-body-notes.js'

const REDACTED_VALUE = '[REDACTED]'
const MAX_JSON_REDACTION_DEPTH = 100

const SENSITIVE_NAME = /(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passwrd|passcode|passphrase|pwd|secret|session|token)/i
// A signed storage or download link carries its signature in one of these query parameters (Azure SAS, CloudFront,
// S3, Google Cloud Storage, Alibaba OSS, Tencent COS, Akamai tokens, GitHub release assets' `sig` and `jwt`,
// SharePoint and OneDrive downloads' `tempauth`, Discord attachments' `hm`, `hmac` as Shopify and others sign links,
// nginx secure links' `md5`), and the link works for anyone until it expires. Matched whole, since `sig` and `hm` are
// parts of many ordinary names. The in-page snapshot scripts repeat this pattern.
const SIGNED_URL_PARAMETER = /^(?:sig|signature|jwt|q-signature|x-[a-z0-9]+-signature|hdnt[sla]|tempauth|hm|hmac|md5)$/i
// A link or form can carry a key, a sign-in or a session in one of these parameters (a Google API `key`, `access_key`,
// an Azure API Management `subscription-key`, `auth`, a PHP session's `PHPSESSID` or `sid`). Matched whole, since `key`, `auth` and `sid` are parts of many
// ordinary names. The in-page snapshot scripts repeat this pattern.
const KEY_URL_PARAMETER = /^(?:key|access[-_]?key|subscription[-_]?key|auth|sid|phpsessid)$/i
// A password field named `pass` or `pw`, with a digit for a new password's two fields, whole, as the last word of a
// name or as one part of a bracketed form name: Drupal's `pass`, `pass[pass1]` and `current_pass`, WordPress's `pass1`
// and `pass2` when a password is set, Roundcube's `_pass`, Horde's `horde_pass`, and `pw` on many other sites. Names
// that only contain them stay readable, such as `passenger`, `compass`, `pwa` or `pass_rate`; a name that ends in one,
// such as `boarding_pass`, is redacted too. The in-page snapshot scripts repeat this pattern.
const PASSWORD_FIELD = /(?:^|[[_-])(?:pass|pw)\d?(?:[\][]|$)/i
// A Java server that keeps its session in the address puts it in the path: `/cart;jsessionid=…`. Replaced with
// `PATH_SESSION_REDACTED`, which keeps the name as the server spelled it.
const PATH_SESSION = /;(jsessionid)=[^;/]*/giu
const PATH_SESSION_REDACTED = `;$1=${REDACTED_VALUE}`
// Headers whose value is an address, such as a redirect's target, which can be a signed link.
const URL_HEADER = /^(?:location|content-location|referer)$/i
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
  return SENSITIVE_NAME.test(name) || PASSWORD_FIELD.test(name)
}

// A test report's `"pass": true` or a form's `"pw": null` holds no password, so a JSON true, false or null stays readable
// under a name only PASSWORD_FIELD matches. A number does not, since a PIN can be one.
function isPasswordFieldFlag(name: string, value: unknown): boolean {
  return (value === null || typeof value === 'boolean') && !SENSITIVE_NAME.test(name)
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
    if (isSensitiveName(key) && !isPasswordFieldFlag(key, item)) {
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
    if (isSensitiveName(name)) safe[name] = REDACTED_VALUE
    else if (URL_HEADER.test(name)) safe[name] = Array.isArray(value) ? value.map(redactHeaderUrl) : redactHeaderUrl(value)
    else safe[name] = Array.isArray(value) ? [...value] : value
  }
  return safe
}

/**
 * An address header's value with its secrets redacted; a relative address, as `Location` allows, keeps its form. A
 * Java server's relative redirect commonly carries its session in the path, as `/home;jsessionid=…`.
 */
function redactHeaderUrl(value: string): string {
  if (URL.canParse(value)) return redactNetworkUrl(value)
  const fragmentStart = value.indexOf('#')
  const address = fragmentStart < 0 ? value : value.slice(0, fragmentStart)
  const queryStart = address.indexOf('?')
  const path = (queryStart < 0 ? address : address.slice(0, queryStart)).replace(PATH_SESSION, PATH_SESSION_REDACTED)
  const query = queryStart < 0 ? '' : address.slice(queryStart)
  const redacted = query ? redactParameters(new URLSearchParams(query.slice(1))) : undefined
  const safe = `${path}${redacted ? `?${redacted.toString()}` : query}`
  // Like an absolute address, a changed one loses its fragment.
  return safe === address ? value : safe
}

function redactParameters(parameters: URLSearchParams): URLSearchParams | undefined {
  const visible: Array<[string, string]> = []
  const sensitive = new Map<string, number>()
  for (const [name, value] of parameters) {
    if (!isSensitiveName(name) && !SIGNED_URL_PARAMETER.test(name) && !KEY_URL_PARAMETER.test(name)) {
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
    const path = url.pathname.replace(PATH_SESSION, PATH_SESSION_REDACTED)
    if (path !== url.pathname) url.pathname = path
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
    return boundBody(NETWORK_BODY_PLACEHOLDERS.binary, originalChars, maxChars, true)
  }
  if (!body) return { text: '', originalChars: 0, truncated: false, redacted: false }
  if (MULTIPART_CONTENT_TYPE.test(normalizedType)) {
    return boundBody(NETWORK_BODY_PLACEHOLDERS.multipart, originalChars, maxChars, true)
  }
  if (JSON_CONTENT_TYPE.test(normalizedType) || /^[\s\r\n]*[\[{]/.test(body)) {
    try {
      const parsed: unknown = JSON.parse(body)
      try {
        const result = redactJsonValue(parsed)
        return boundBody(JSON.stringify(result.value, null, 2), originalChars, maxChars, result.redacted)
      } catch {
        // Valid JSON must never fall back to raw text if secret redaction fails.
        return boundBody(NETWORK_BODY_PLACEHOLDERS.unsafeJson, originalChars, maxChars, true)
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
    return boundBody(NETWORK_BODY_PLACEHOLDERS.nonText, originalChars, maxChars, true)
  }
  return boundBody(body, originalChars, maxChars, false)
}
