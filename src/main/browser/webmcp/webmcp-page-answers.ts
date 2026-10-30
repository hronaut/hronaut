import { WEBMCP_LIMITS, type WebMcpToolDescriptor } from '../webmcp-bridge.js'

// The WebMCP bridge runs in the page's own world, where the page can replace any built-in the bridge uses, so what it
// answers is the page's word. Main keeps only the fields it knows, of the types and sizes the bridge itself gives.

const MAX_REASON_CHARS = 500
// Escaping can make each character of a name, title or description six in JSON; the schema's limit is on its JSON.
const MAX_DESCRIPTOR_JSON_CHARS = WEBMCP_LIMITS.maxTools * (
  6 * (WEBMCP_LIMITS.maxNameChars + WEBMCP_LIMITS.maxTitleChars + WEBMCP_LIMITS.maxDescriptionChars)
  + WEBMCP_LIMITS.maxSchemaChars + 512
)
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
  return { supported: page.supported === true, ...(reason ? { reason } : {}) }
}

/**
 * The page's tools from the bridge's list answer: its descriptor JSON and the tools parsed from that JSON, each within
 * the bridge's limits, or why there are none.
 */
export function webMcpListingFromPage(answer: unknown):
  | { listed: true; descriptorJson: string; tools: WebMcpToolDescriptor[] }
  | { listed: false; supported: boolean; reason: string; status?: string } {
  const page = recordOf(answer)
  if (page.supported === true && typeof page.descriptorJson === 'string') {
    const tools = descriptorsOf(page.descriptorJson)
    if (tools) return { listed: true, descriptorJson: page.descriptorJson, tools }
    return { listed: false, supported: true, reason: 'The page did not return a valid WebMCP descriptor', status: 'WEBMCP_ERROR' }
  }
  const status = typeof page.status === 'string' && LIST_STATUSES.has(page.status) ? page.status : undefined
  return {
    listed: false,
    supported: page.supported === true,
    reason: textOf(page.error) ?? textOf(page.reason) ?? status ?? 'The page did not return a valid WebMCP descriptor',
    ...(status ? { status } : {})
  }
}

/**
 * The outcome of a call from the bridge's call answer: one of the bridge's statuses, with the dispatch and effects that
 * status means, its reason or error and, for a returned result, the result within the bridge's limit. An answer with no
 * such status says the page changed the bridge, which may have called the tool.
 */
export function webMcpCallFromPage(answer: unknown): Record<string, unknown> {
  const page = recordOf(answer)
  if (page.supported !== true) {
    return { supported: false, reason: textOf(page.reason) ?? 'document.modelContext is unavailable in this page' }
  }
  const status = typeof page.status === 'string' && Object.hasOwn(CALL_DISPATCH, page.status) ? page.status : undefined
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
    ...(reason ? { reason } : {}),
    ...(error ? { error } : {}),
    ...(status === 'TOOL_RETURNED' ? { result: boundedResult(page.result) } : {})
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, MAX_REASON_CHARS) : undefined
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
  return new Set(tools.map(tool => tool.name)).size === tools.length ? tools : undefined
}

function descriptorOf(value: unknown): WebMcpToolDescriptor | undefined {
  const tool = recordOf(value)
  if (value !== tool || Object.keys(tool).some(key => !DESCRIPTOR_KEYS.has(key))) return undefined
  const { name, title, description, inputSchema, annotations } = tool
  if (typeof name !== 'string' || name.length < 1 || name.length > WEBMCP_LIMITS.maxNameChars) return undefined
  if (title !== undefined && (typeof title !== 'string' || title.length > WEBMCP_LIMITS.maxTitleChars)) return undefined
  if (description !== undefined && (typeof description !== 'string' || description.length > WEBMCP_LIMITS.maxDescriptionChars)) return undefined
  if (inputSchema !== undefined && JSON.stringify(inputSchema).length > WEBMCP_LIMITS.maxSchemaChars) return undefined
  if (annotations !== undefined) {
    const hints = recordOf(annotations)
    if (annotations !== hints || Object.entries(hints).some(([key, hint]) => !ANNOTATION_KEYS.has(key) || typeof hint !== 'boolean')) return undefined
  }
  return tool as unknown as WebMcpToolDescriptor
}

/**
 * A tool's result as JSON within the bridge's limit, or the start of that JSON when it is longer, as the bridge itself
 * gives a longer result.
 */
function boundedResult(value: unknown): { value: unknown; truncated?: true } {
  const result = recordOf(value)
  const preview = recordOf(result.value)
  if (result.truncated === true && Object.keys(preview).length === 2 && preview.serialization === 'truncated-json'
    && typeof preview.preview === 'string' && preview.preview.length <= WEBMCP_LIMITS.maxResultChars) {
    return { value: { preview: preview.preview, serialization: 'truncated-json' }, truncated: true }
  }
  let json: string
  try {
    json = JSON.stringify(result.value) ?? 'null'
  } catch {
    return { value: null, truncated: true }
  }
  if (json.length > WEBMCP_LIMITS.maxResultChars) {
    return { value: { preview: json.slice(0, WEBMCP_LIMITS.maxResultChars), serialization: 'truncated-json' }, truncated: true }
  }
  return { value: JSON.parse(json) as unknown, ...(result.truncated === true ? { truncated: true as const } : {}) }
}
