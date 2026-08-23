import type { BrowserNetworkRequestDetails } from './types.js'
import { redactNetworkUrl } from './network-details.js'

export type BrowserNetworkRequestCopyFormat = 'curl' | 'fetch'

const REDACTED_VALUE = '[REDACTED]'
const MAX_COPY_HEADERS = 64
const MAX_HEADER_VALUE_CHARS = 2_000
const MAX_COPY_URL_CHARS = 8_000
const MAX_COPY_BODY_CHARS = 20_000
const SENSITIVE_HEADER_NAME = /(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|secret|session|token)/i
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
    throw new Error('Sanitized cURL and fetch copies require a valid HTTP(S) request URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Sanitized cURL and fetch copies are available only for HTTP(S) requests.')
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
  const bodyIsOmittedPlaceholder = requestBodyText?.startsWith('[multipart body omitted]')
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
  const lines = [
    `# ${safetySummary(payload)}`,
    `curl --request ${shellQuote(payload.method)} \\`,
    `  --url ${shellQuote(payload.url)}`
  ]
  for (const header of payload.headers) {
    lines[lines.length - 1] += ' \\'
    lines.push(`  --header ${shellQuote(`${header.name}: ${header.value}`)}`)
  }
  if (payload.body !== undefined) {
    lines[lines.length - 1] += ' \\'
    lines.push(`  --data-raw ${shellQuote(payload.body)}`)
  }
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
  return format === 'curl' ? formatCurl(payload) : formatFetch(payload)
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
