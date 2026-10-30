import { WEBMCP_LIMITS, type WebMcpToolDescriptor } from '../webmcp-bridge.js'

// The WebMCP bridge runs in the page's own world, where the page can replace any built-in the bridge uses, so what it
// answers is the page's word. Main keeps only the fields it knows, of the types, shapes and sizes the bridge itself gives.

const MAX_REASON_CHARS = 500
// Escaping can make each character of a name, title or description six in JSON; the schema's limit is on its JSON.
const MAX_DESCRIPTOR_JSON_CHARS = WEBMCP_LIMITS.maxTools * (
  6 * (WEBMCP_LIMITS.maxNameChars + WEBMCP_LIMITS.maxTitleChars + WEBMCP_LIMITS.maxDescriptionChars)
  + WEBMCP_LIMITS.maxSchemaChars + 512
)
// Deeper than any tool's input schema, and shallow enough for main to read and write it without running out of stack.
const MAX_SCHEMA_DEPTH = 64
// What the bridge keeps of a tool's result: strings, arrays and objects up to these sizes, objects nested up to this depth.
const MAX_RESULT_STRING_CHARS = 20_000
const MAX_RESULT_ENTRIES = 100
const MAX_RESULT_DEPTH = 8
const DESCRIPTOR_KEYS = new Set(['name', 'title', 'description', 'inputSchema', 'annotations'])
const ANNOTATION_KEYS = new Set(['readOnlyHint', 'untrustedContentHint', 'consequentialHint', 'debugging'])
const LIST_STATUSES = new Set(['WEBMCP_TIMEOUT', 'WEBMCP_ERROR'])
// Each status the bridge gives for a call, with whether it had called the page's tool by then.
const CALL_DISPATCH: Record<string, { dispatch: 'not-dispatched' | 'dispatched'; effects: 'none' | 'possible' }> = {
  STALE_DESCRIPTOR: { dispatch: 'not-dispatched', effects: 'none' },
  TOOL_REMOVED: { dispatch: 'not-dispatched', effects: 'none' },
  WEBMCP_TIMEOUT: { dispatch: 'not-dispatched', effects: 'none' },
  WEBMCP_ERROR: { dispatch: 'not-dispatched', effects: 'none' },
  OUTCOME_UNKNOWN: { dispatch: 'dispatched', effects: 'possible' },
  TOOL_ERROR: { dispatch: 'dispatched', effects: 'possible' },
  TOOL_RETURNED: { dispatch: 'dispatched', effects: 'possible' }
}

/** Whether the page exposes WebMCP, and why not, from the bridge's status answer. */
export function webMcpStatusFromPage(answer: unknown): { supported: boolean; reason?: string } {
  const page = recordOf(answer)
  const reason = textOf(page.reason)
  return { supported: page.supported === true, ...(reason !== undefined ? { reason } : {}) }
}

/**
 * The page's tools from the bridge's list answer: its descriptor JSON, in the bridge's canonical form, and the tools
 * parsed from it, each within the bridge's limits; or why there are none, with a status when the page has WebMCP.
 */
export function webMcpListingFromPage(answer: unknown):
  | { listed: true; descriptorJson: string; tools: WebMcpToolDescriptor[] }
  | { listed: false; supported: boolean; reason: string; status?: string } {
  const page = recordOf(answer)
  const invalid = 'The page did not return a valid WebMCP descriptor'
  if (page.supported === true && typeof page.descriptorJson === 'string') {
    const tools = descriptorsOf(page.descriptorJson)
    if (tools) return { listed: true, descriptorJson: page.descriptorJson, tools }
    return { listed: false, supported: true, reason: invalid, status: 'WEBMCP_ERROR' }
  }
  const supported = page.supported === true
  const pageStatus = typeof page.status === 'string' && LIST_STATUSES.has(page.status) ? page.status : undefined
  const status = pageStatus ?? (supported ? 'WEBMCP_ERROR' : undefined)
  return {
    listed: false,
    supported,
    reason: textOf(page.error) ?? textOf(page.reason) ?? pageStatus ?? invalid,
    ...(status ? { status } : {})
  }
}

/**
 * The outcome of a call from the bridge's call answer: one of the bridge's statuses, with the dispatch and effects that
 * status means, its reason or error and, for a returned result, the result as the bridge bounds it. An answer that is
 * neither that nor the bridge's "unsupported" says the page changed the bridge, which may have called the tool.
 */
export function webMcpCallFromPage(answer: unknown): Record<string, unknown> {
  const page = recordOf(answer)
  if (page.supported === false) {
    return { supported: false, reason: textOf(page.reason) ?? 'document.modelContext is unavailable in this page' }
  }
  const status = page.supported === true && typeof page.status === 'string' && Object.hasOwn(CALL_DISPATCH, page.status)
    ? page.status : undefined
  if (!status) {
    return {
      supported: true, status: 'WEBMCP_ERROR', dispatch: 'possibly-dispatched', effects: 'possible', retrySafe: false,
      reason: 'The page returned no valid WebMCP outcome'
    }
  }
  const reason = textOf(page.reason)
  const error = textOf(page.error)
  return {
    supported: true,
    status,
    ...CALL_DISPATCH[status],
    ...(reason !== undefined ? { reason } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(status === 'TOOL_RETURNED' ? { result: boundedResult(page.result) } : {})
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_REASON_CHARS) : undefined
}

function descriptorsOf(json: string): WebMcpToolDescriptor[] | undefined {
  if (json.length > MAX_DESCRIPTOR_JSON_CHARS) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || parsed.length > WEBMCP_LIMITS.maxTools) return undefined
  const tools = parsed.map(descriptorOf)
  if (!tools.every((tool): tool is WebMcpToolDescriptor => tool !== undefined)) return undefined
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) return undefined
  // The bridge writes its descriptor in one form, so the JSON main keeps and digests is no larger than the tools in it.
  return canonical(tools) === json ? tools : undefined
}

function descriptorOf(value: unknown): WebMcpToolDescriptor | undefined {
  const tool = recordOf(value)
  if (value !== tool || Object.keys(tool).some(key => !DESCRIPTOR_KEYS.has(key))) return undefined
  const { name, title, description, inputSchema, annotations } = tool
  if (typeof name !== 'string' || name.length < 1 || name.length > WEBMCP_LIMITS.maxNameChars) return undefined
  if (title !== undefined && (typeof title !== 'string' || title.length > WEBMCP_LIMITS.maxTitleChars)) return undefined
  if (description !== undefined && (typeof description !== 'string' || description.length > WEBMCP_LIMITS.maxDescriptionChars)) return undefined
  if (inputSchema !== undefined && (nestedDeeperThan(inputSchema, MAX_SCHEMA_DEPTH)
    || JSON.stringify(inputSchema).length > WEBMCP_LIMITS.maxSchemaChars)) return undefined
  if (annotations !== undefined) {
    const hints = recordOf(annotations)
    if (annotations !== hints || Object.entries(hints).some(([key, hint]) => !ANNOTATION_KEYS.has(key) || typeof hint !== 'boolean')) return undefined
  }
  return tool as unknown as WebMcpToolDescriptor
}

function nestedDeeperThan(value: unknown, depth: number): boolean {
  if (value === null || typeof value !== 'object') return false
  return depth === 0 || Object.values(value).some(child => nestedDeeperThan(child, depth - 1))
}

/** JSON with every object's keys sorted, as the bridge writes a descriptor. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

/**
 * A tool's result bounded as the bridge bounds it, which leaves a result the bridge bounded as it is: strings, arrays
 * and objects cut to their limits, objects past the depth limit and repeated ones as `[truncated]`, and JSON longer
 * than the result limit as the start of that JSON.
 */
function boundedResult(value: unknown): { value: unknown; truncated?: true } {
  const result = recordOf(value)
  const preview = recordOf(result.value)
  if (result.truncated === true && Object.keys(preview).length === 2 && preview.serialization === 'truncated-json'
    && typeof preview.preview === 'string' && preview.preview.length <= WEBMCP_LIMITS.maxResultChars) {
    return { value: { preview: preview.preview, serialization: 'truncated-json' }, truncated: true }
  }
  const seen = new WeakSet<object>()
  let truncated = result.truncated === true
  const visit = (candidate: unknown, depth: number): unknown => {
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') return candidate
    if (typeof candidate === 'string') {
      if (candidate.length <= MAX_RESULT_STRING_CHARS) return candidate
      truncated = true
      return candidate.slice(0, MAX_RESULT_STRING_CHARS)
    }
    if (typeof candidate === 'bigint') return candidate.toString()
    if (typeof candidate !== 'object') return String(candidate)
    if (seen.has(candidate) || depth >= MAX_RESULT_DEPTH) {
      truncated = true
      return '[truncated]'
    }
    seen.add(candidate)
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_RESULT_ENTRIES) truncated = true
      return candidate.slice(0, MAX_RESULT_ENTRIES).map(item => visit(item, depth + 1))
    }
    const source = candidate as Record<string, unknown>
    const keys = Object.keys(source).sort()
    if (keys.length > MAX_RESULT_ENTRIES) truncated = true
    return Object.fromEntries(keys.slice(0, MAX_RESULT_ENTRIES).map(key => [key, visit(source[key], depth + 1)]))
  }
  let safe = visit(result.value, 0)
  let json = JSON.stringify(safe)
  if (json.length > WEBMCP_LIMITS.maxResultChars) {
    truncated = true
    safe = { preview: json.slice(0, WEBMCP_LIMITS.maxResultChars), serialization: 'truncated-json' }
    json = JSON.stringify(safe)
  }
  return { value: JSON.parse(json) as unknown, ...(truncated ? { truncated: true as const } : {}) }
}
