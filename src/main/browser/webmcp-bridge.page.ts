import type { WEBMCP_LIMITS } from './webmcp-bridge.js'

/**
 * Runs in the page's own world, where document.modelContext lives: the page's WebMCP status, the tools of its top-level
 * document and same-origin frames as canonical descriptor JSON, or the outcome of calling one tool that still has the
 * descriptor the caller listed. Main checks every answer again, since the page can change anything this reads.
 */
export function webMcpBridgeInPage(
  mode: 'status' | 'list' | 'call',
  payload: Record<string, unknown>,
  limits: typeof WEBMCP_LIMITS
): Record<string, unknown> | Promise<Record<string, unknown>> {
  const api = (document as unknown as {
    modelContext?: {
      getTools: () => Promise<unknown[]>
      executeTool: (tool: Record<string, unknown>, input: unknown, options?: { signal: AbortSignal }) => Promise<unknown>
    }
  }).modelContext
  if (!api || typeof api.getTools !== 'function' || typeof api.executeTool !== 'function') {
    return { supported: false, reason: 'document.modelContext is unavailable in this page' }
  }

  const safeMessage = (error: unknown): string => {
    try {
      return String(error instanceof Error ? error.message : error).slice(0, 500)
    } catch {
      return 'The page threw a value that cannot be read'
    }
  }
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  const nestedDeeperThan = (value: unknown, depth: number): boolean => {
    if (value === null || typeof value !== 'object') return false
    return depth === 0 || Object.values(value).some(child => nestedDeeperThan(child, depth - 1))
  }
  // Where a tool's document sits below the top-level one, as frame indexes from the top ('' for the top itself), the
  // way Chrome's agent tells same-named tools of different frames apart. Undefined for a window outside this page.
  const framePath = (owner: unknown): string | undefined => {
    const path: number[] = []
    let current = owner
    for (let depth = 0; depth < 16; depth += 1) {
      // window.frames is the page's own WindowProxy, the object a frame's parent gives.
      if (current === window || current === window.frames) return path.reverse().join('.')
      if (!current || typeof current !== 'object') return undefined
      const parent = (current as Window).parent
      if (!parent || parent === current) return undefined
      let index = -1
      for (let candidate = 0; candidate < parent.frames.length; candidate += 1) {
        if (parent.frames[candidate] === current) {
          index = candidate
          break
        }
      }
      if (index < 0) return undefined
      path.push(index)
      current = parent
    }
    return undefined
  }
  const normalize = (tools: unknown[]): { descriptors: unknown[]; descriptorJson: string; raw: Record<string, unknown>[] } => {
    // Tools of this page's own origin, from its top-level document or a frame inside it, as Chrome's agent sees them.
    // The draft names a tool's window `source`; Chromium 156 still names it `window`.
    const sameOrigin = tools.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return []
      const tool = candidate as Record<string, unknown>
      if (tool.origin !== location.origin) return []
      const frame = framePath(tool.source ?? tool.window)
      return frame === undefined ? [] : [{ tool, frame }]
    })
    if (sameOrigin.length > limits.maxTools) throw new Error(`The page exposes more than ${limits.maxTools} WebMCP tools`)
    const entries = sameOrigin.map(({ tool, frame }) => {
      if (typeof tool.name !== 'string' || tool.name.length < 1 || tool.name.length > limits.maxNameChars) {
        throw new Error('A WebMCP tool has an invalid or oversized name')
      }
      const optionalText = (key: 'title' | 'description', max: number): string | undefined => {
        const value = tool[key]
        if (value === undefined) return undefined
        if (typeof value !== 'string' || value.length > max) throw new Error(`WebMCP tool ${tool.name} has invalid or oversized ${key}`)
        return value
      }
      const descriptor: Record<string, unknown> = { name: tool.name }
      const title = optionalText('title', limits.maxTitleChars)
      const description = optionalText('description', limits.maxDescriptionChars)
      if (title !== undefined) descriptor.title = title
      if (description !== undefined) descriptor.description = description
      if (frame) descriptor.frame = frame
      if (tool.inputSchema !== undefined && tool.inputSchema !== null) {
        const inputSchema = tool.inputSchema
        if (typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
          throw new Error(`WebMCP tool ${tool.name} has an input schema that is not a JSON object`)
        }
        if (nestedDeeperThan(inputSchema, limits.maxSchemaDepth)) {
          throw new Error(`WebMCP tool ${tool.name} has an input schema nested more than ${limits.maxSchemaDepth} levels deep`)
        }
        const schemaJson = canonical(inputSchema)
        if (schemaJson.length > limits.maxSchemaChars) throw new Error(`WebMCP tool ${tool.name} has an oversized input schema`)
        descriptor.inputSchema = JSON.parse(schemaJson)
      }
      if (tool.annotations && typeof tool.annotations === 'object') {
        const source = tool.annotations as Record<string, unknown>
        const annotations: Record<string, boolean> = {}
        for (const key of ['readOnlyHint', 'untrustedContentHint', 'consequentialHint', 'debugging']) {
          if (typeof source[key] === 'boolean') annotations[key] = source[key] as boolean
        }
        if (Object.keys(annotations).length) descriptor.annotations = annotations
      }
      return { descriptor, tool, frame }
    })
    // By name in code unit order, as getTools() sorts them, then by frame.
    const order = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)
    entries.sort((left, right) => order(String(left.descriptor.name), String(right.descriptor.name)) || order(left.frame, right.frame))
    const keys = entries.map(entry => `${entry.frame}\0${String(entry.descriptor.name)}`)
    if (new Set(keys).size !== keys.length) throw new Error('A document of the page exposes duplicate WebMCP tool names')
    const descriptors = entries.map(entry => entry.descriptor)
    return { descriptors, descriptorJson: canonical(descriptors), raw: entries.map(entry => entry.tool) }
  }
  const boundedResult = (value: unknown): { value: unknown; truncated?: true } => {
    const seen = new WeakSet<object>()
    let truncated = false
    const visit = (candidate: unknown, depth: number): unknown => {
      if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') return candidate
      // A string, and a value JSON has no form for, such as a big integer, as its text.
      if (typeof candidate !== 'object') {
        const text = String(candidate)
        if (text.length <= 20_000) return text
        truncated = true
        return text.slice(0, 20_000)
      }
      if (seen.has(candidate as object) || depth >= 8) {
        truncated = true
        return '[truncated]'
      }
      seen.add(candidate as object)
      if (Array.isArray(candidate)) {
        if (candidate.length > 100) truncated = true
        return candidate.slice(0, 100).map(item => visit(item, depth + 1))
      }
      const source = candidate as Record<string, unknown>
      const keys = Object.keys(source).sort()
      if (keys.length > 100) truncated = true
      return Object.fromEntries(keys.slice(0, 100).map(key => [key, visit(source[key], depth + 1)]))
    }
    let safe = visit(value, 0)
    let json = JSON.stringify(safe)
    if (json.length > limits.maxResultChars) {
      truncated = true
      safe = { preview: json.slice(0, limits.maxResultChars), serialization: 'truncated-json' }
      json = JSON.stringify(safe)
    }
    return { value: JSON.parse(json), ...(truncated ? { truncated: true as const } : {}) }
  }

  const controller = new AbortController()
  // Once the page's tool is called, any later failure may follow its effects.
  let dispatched = false
  let timeoutId = 0
  const timeout = new Promise<Record<string, unknown>>(resolve => {
    timeoutId = window.setTimeout(() => {
      controller.abort()
      resolve({ __hronautTimeout: true })
    }, limits.timeoutMs)
  })
  const clearDeadline = (): void => clearTimeout(timeoutId)
  return Promise.race([
    Promise.resolve()
      .then(() => api.getTools())
      .then((tools: unknown[]) => ({ __hronautTools: tools }))
      .catch((error: unknown) => ({
        __hronautEnumerationError: safeMessage(error),
        __hronautPolicyDisabled: error instanceof DOMException && error.name === 'NotAllowedError'
      })),
    timeout
  ]).then(async (enumeration: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (enumeration.__hronautTimeout) {
      return {
        supported: true, status: 'WEBMCP_TIMEOUT', dispatch: 'not-dispatched', effects: 'none',
        reason: 'tool-enumeration-timeout'
      }
    }
    if (enumeration.__hronautPolicyDisabled === true) {
      clearDeadline()
      return { supported: false, reason: 'The page turns WebMCP off with its Permissions-Policy (tools=())' }
    }
    if (typeof enumeration.__hronautEnumerationError === 'string') {
      clearDeadline()
      return {
        supported: true, status: 'WEBMCP_ERROR', dispatch: 'not-dispatched', effects: 'none',
        error: enumeration.__hronautEnumerationError
      }
    }
    if (mode === 'status') {
      clearDeadline()
      return { supported: true }
    }
    const listing = normalize(enumeration.__hronautTools as unknown[])
    if (mode === 'list') {
      clearDeadline()
      return { supported: true, descriptorJson: listing.descriptorJson }
    }
    if (listing.descriptorJson !== payload.descriptorJson) {
      clearDeadline()
      return { supported: true, status: 'STALE_DESCRIPTOR', dispatch: 'not-dispatched', effects: 'none' }
    }
    const frame = typeof payload.frame === 'string' ? payload.frame : ''
    const index = listing.descriptors.findIndex((descriptor: unknown) => {
      if (!descriptor || typeof descriptor !== 'object') return false
      const listed = descriptor as Record<string, unknown>
      return listed.name === payload.toolName && (listed.frame ?? '') === frame
    })
    if (index < 0) {
      clearDeadline()
      return { supported: true, status: 'TOOL_REMOVED', dispatch: 'not-dispatched', effects: 'none' }
    }
    const executionInput = payload.arguments ?? {}
    const outcome = await Promise.race([
      // Defer invocation into the promise chain so a synchronous throw after
      // entering the page callback is still classified as dispatched.
      Promise.resolve().then(() => {
        dispatched = true
        return api.executeTool(listing.raw[index]!, executionInput, { signal: controller.signal })
      })
        .then((value: unknown) => ({ __hronautResult: value }))
        .catch((error: unknown) => ({ __hronautError: safeMessage(error) })),
      timeout
    ]) as Record<string, unknown>
    clearDeadline()
    if (outcome.__hronautTimeout) {
      return { supported: true, status: 'OUTCOME_UNKNOWN', dispatch: 'dispatched', effects: 'possible', reason: 'timeout' }
    }
    if (typeof outcome.__hronautError === 'string') {
      return { supported: true, status: 'TOOL_ERROR', dispatch: 'dispatched', effects: 'possible', error: outcome.__hronautError }
    }
    let returnedValue = outcome.__hronautResult
    if (typeof returnedValue === 'string') {
      try { returnedValue = JSON.parse(returnedValue) } catch { /* Preserve a non-JSON legacy result as text. */ }
    }
    return {
      supported: true,
      status: 'TOOL_RETURNED',
      dispatch: 'dispatched',
      effects: 'possible',
      result: boundedResult(returnedValue)
    }
  }).catch((error: unknown) => {
    clearDeadline()
    if (dispatched) {
      return {
        supported: true, status: 'OUTCOME_UNKNOWN', dispatch: 'dispatched', effects: 'possible', reason: 'result-unreadable',
        error: safeMessage(error)
      }
    }
    return { supported: true, status: 'WEBMCP_ERROR', dispatch: 'not-dispatched', effects: 'none', error: safeMessage(error) }
  })
}
