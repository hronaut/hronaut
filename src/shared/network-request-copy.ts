import type { BrowserNetworkRequestDetails } from './types.js'
import { redactNetworkUrl } from './network-details.js'

export type BrowserNetworkRequestCopyFormat = 'curl' | 'fetch' | 'powershell'

const REDACTED_VALUE = '[REDACTED]'
const MAX_COPY_HEADERS = 64
const MAX_HEADER_VALUE_CHARS = 2_000
const MAX_COPY_URL_CHARS = 8_000
const MAX_COPY_BODY_CHARS = 20_000
const SENSITIVE_HEADER_NAME = /(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|passphrase|pwd|secret|session|token)/i
const OMITTED_REPLAY_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding'
])
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const HTTP_METHOD = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/
/** Methods Windows PowerShell 5.1's `Invoke-WebRequest -Method` accepts; PowerShell 7 accepts them too. */
const POWERSHELL_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'MERGE'])

interface CopyHeader {
  name: string
  value: string
}

interface CopyPayload {
  url: string
  method: string
  headers: CopyHeader[]
  body?: string
  bodyOmitted: boolean
  omittedHeaders: number
}

function normalizedRequestUrl(input: string): string {
  const sanitized = redactNetworkUrl(input)
  let url: URL
  try {
    url = new URL(sanitized)
  } catch {
    throw new Error('Sanitized cURL, PowerShell and fetch copies require a valid HTTP(S) request URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Sanitized cURL, PowerShell and fetch copies are available only for HTTP(S) requests.')
  }
  if (sanitized.length > MAX_COPY_URL_CHARS) {
    throw new Error(`The request URL is too long to copy safely (maximum ${MAX_COPY_URL_CHARS} characters).`)
  }
  return sanitized
}

function normalizedRequestMethod(input: string): string {
  const method = input.toUpperCase()
  if (!HTTP_METHOD.test(method)) {
    throw new Error('The request method cannot be represented as a sanitized replay command.')
  }
  return method
}

function copyPayload(details: BrowserNetworkRequestDetails): CopyPayload {
  const headers: CopyHeader[] = []
  let omittedHeaders = 0
  for (const [name, rawValue] of Object.entries(details.request.headers)) {
    const normalizedName = name.trim()
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    if (!HEADER_NAME.test(normalizedName)
      || SENSITIVE_HEADER_NAME.test(normalizedName)
      || OMITTED_REPLAY_HEADERS.has(normalizedName.toLowerCase())) {
      omittedHeaders += values.length
      continue
    }
    for (const value of values) {
      const normalizedValue = value.replace(/[\r\n]+/g, ' ')
      if (value === REDACTED_VALUE
        || normalizedValue.length > MAX_HEADER_VALUE_CHARS
        || headers.length >= MAX_COPY_HEADERS) {
        omittedHeaders += 1
        continue
      }
      headers.push({ name: normalizedName, value: normalizedValue })
    }
  }

  const requestBody = details.request.body
  const requestBodyText = requestBody?.text
  const bodyIsOmittedPlaceholder = requestBodyText?.startsWith('[JSON body omitted:')
    || requestBodyText?.startsWith('[multipart body omitted]')
    || requestBodyText?.startsWith('[non-text body omitted]')
    || requestBodyText?.startsWith('[binary body omitted]')
  const body = requestBody
    && requestBodyText !== undefined
    && !requestBody.truncated
    && !bodyIsOmittedPlaceholder
    && requestBodyText.length <= MAX_COPY_BODY_CHARS
    ? requestBodyText
    : undefined

  return {
    url: normalizedRequestUrl(details.url),
    method: normalizedRequestMethod(details.method),
    headers,
    ...(body !== undefined ? { body } : {}),
    bodyOmitted: Boolean(requestBody && body === undefined),
    omittedHeaders
  }
}

function shellQuote(value: string): string {
  // POSIX process arguments cannot contain NUL; quoting cannot preserve it.
  if (value.includes('\u0000')) {
    throw new Error('Copy cURL cannot represent literal NUL characters. Use Copy fetch instead.')
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function safetySummary(payload: CopyPayload): string {
  const omissions = [
    payload.omittedHeaders ? `${payload.omittedHeaders} sensitive, transport, invalid, or oversized ${payload.omittedHeaders === 1 ? 'header was' : 'headers were'} omitted` : '',
    payload.bodyOmitted ? 'the incomplete, oversized, or non-text request body was omitted' : ''
  ].filter(Boolean)
  return `Sanitized by Hronaut: recognized secret headers, URL credentials, and security-related query values are omitted or redacted; structured body secrets use ${REDACTED_VALUE}, but arbitrary URL paths and body text can remain${omissions.length ? `; ${omissions.join('; ')}` : ''}. Review before sharing or running.`
}

function formatCurl(payload: CopyPayload): string {
  const methodOption = payload.method === 'HEAD' ? '--head' : `--request ${shellQuote(payload.method)}`
  const lines = [
    `# ${safetySummary(payload)}`,
    `curl ${methodOption} --globoff \\`,
    `  --url ${shellQuote(payload.url)}`
  ]
  for (const header of payload.headers) {
    lines[lines.length - 1] += ' \\'
    // A colon with no value tells curl to omit the header; a semicolon sends it empty.
    const field = header.value === '' ? `${header.name};` : `${header.name}: ${header.value}`
    lines.push(`  --header ${shellQuote(field)}`)
  }
  if (payload.body !== undefined) {
    lines[lines.length - 1] += ' \\'
    lines.push(`  --data-raw ${shellQuote(payload.body)}`)
  }
  return lines.join('\n')
}

// PowerShell also reads the typographic single quotes as quote characters, so each is doubled like the ASCII one.
function powerShellLiteral(value: string): string {
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, quote => quote + quote)}'`
}

/**
 * A PowerShell string expression for the exact text. Control characters other than line feed, which a pasted
 * literal could lose or a console could act on (a pasted tab can start completion), are written as `[char]` codes
 * that Windows PowerShell 5.1 and PowerShell 7 both read.
 */
function powerShellText(value: string): string {
  const parts: string[] = []
  let literal = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    if ((code < 0x20 && character !== '\n') || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      if (literal) parts.push(powerShellLiteral(literal))
      literal = ''
      parts.push(`[char]0x${code.toString(16).toUpperCase().padStart(2, '0')}`)
    } else {
      literal += character
    }
  }
  if (literal || !parts.length) parts.push(powerShellLiteral(literal))
  if (parts.length === 1 && !parts[0]!.startsWith('[char]')) return parts[0]!
  // Parentheses make a lone [char] an expression, not argument text; a text first operand keeps every + joining text.
  if (parts[0]!.startsWith('[char]')) parts.unshift("''")
  return `(${parts.join(' + ')})`
}

function formatPowerShell(payload: CopyPayload): string {
  if (!POWERSHELL_METHODS.has(payload.method)) {
    throw new Error('Copy PowerShell supports GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, TRACE and MERGE requests. Use Copy cURL or Copy fetch instead.')
  }
  const body = payload.body === '' && (payload.method === 'GET' || payload.method === 'HEAD') ? undefined : payload.body
  if (body !== undefined && (payload.method === 'GET' || payload.method === 'HEAD')) {
    throw new Error('Copy PowerShell cannot send a request body with GET or HEAD. Use Copy cURL or Copy fetch instead.')
  }
  const seen = new Set<string>()
  const headers: CopyHeader[] = []
  let contentType: string | undefined
  let userAgent: string | undefined
  for (const header of payload.headers) {
    const name = header.name.toLowerCase()
    if (seen.has(name)) throw new Error('Copy PowerShell cannot send the same header more than once. Use Copy cURL or Copy fetch instead.')
    seen.add(name)
    if (header.value.includes('\u0000')) throw new Error('Copy PowerShell cannot send literal NUL characters in a header. Use Copy fetch instead.')
    // Windows PowerShell 5.1 takes these two through their own parameters.
    if (name === 'content-type') contentType = header.value
    else if (name === 'user-agent') userAgent = header.value
    else headers.push(header)
  }
  const lines = [
    `# ${safetySummary(payload)}`,
    '# For Windows PowerShell 5.1 or PowerShell 7 and later. Invoke-WebRequest follows redirects and stops with an error on an HTTP error status.',
    `Invoke-WebRequest -UseBasicParsing -Uri ${powerShellLiteral(payload.url)} \``,
    `  -Method ${powerShellLiteral(payload.method)}`
  ]
  const option = (text: string): void => {
    lines[lines.length - 1] += ' `'
    lines.push(text)
  }
  if (headers.length) {
    option('  -Headers @{')
    for (const header of headers) lines.push(`    ${powerShellLiteral(header.name)} = ${powerShellText(header.value)}`)
    lines.push('  }')
  }
  if (contentType !== undefined) option(`  -ContentType ${powerShellText(contentType)}`)
  if (userAgent !== undefined) option(`  -UserAgent ${powerShellText(userAgent)}`)
  // Bytes keep the text's UTF-8 encoding; Windows PowerShell 5.1 would send a string body as ISO-8859-1.
  if (body !== undefined) option(`  -Body ([System.Text.Encoding]::UTF8.GetBytes(${powerShellText(body)}))`)
  return lines.join('\n')
}

function formatFetch(payload: CopyPayload): string {
  const options: string[] = [`method: ${JSON.stringify(payload.method)}`]
  if (payload.headers.length) {
    const headerRows = payload.headers.map((header) => [header.name, header.value])
    options.push(`headers: ${JSON.stringify(headerRows, null, 2).replace(/\n/g, '\n  ')}`)
  }
  if (payload.body !== undefined) options.push(`body: ${JSON.stringify(payload.body)}`)
  return [
    `/* ${safetySummary(payload)} */`,
    `fetch(${JSON.stringify(payload.url)}, {`,
    `  ${options.join(',\n  ')}`,
    '});'
  ].join('\n')
}

export function formatNetworkRequestCopy(
  details: BrowserNetworkRequestDetails,
  format: BrowserNetworkRequestCopyFormat
): string {
  const payload = copyPayload(details)
  return format === 'curl' ? formatCurl(payload) : format === 'powershell' ? formatPowerShell(payload) : formatFetch(payload)
}

export function canFormatNetworkRequestCopy(details: BrowserNetworkRequestDetails): boolean {
  try {
    normalizedRequestUrl(details.url)
    normalizedRequestMethod(details.method)
    return true
  } catch {
    return false
  }
}
