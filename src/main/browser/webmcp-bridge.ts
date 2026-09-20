import { createHash } from 'node:crypto'

export const WEBMCP_LIMITS = {
  maxTools: 32,
  maxNameChars: 128,
  maxTitleChars: 256,
  maxDescriptionChars: 2_000,
  maxSchemaChars: 32_000,
  maxArgumentsChars: 64_000,
  maxResultChars: 64_000,
  timeoutMs: 30_000
} as const

const legacyWebMcpInputEncoding = Number(process.versions.chrome?.split('.')[0] ?? Number.POSITIVE_INFINITY) <= 152

export interface WebMcpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: {
    readOnlyHint?: boolean
    untrustedContentHint?: boolean
    consequentialHint?: boolean
    debugging?: boolean
  }
}

export interface WebMcpPageListing {
  supported: boolean
  reason?: string
  descriptors?: WebMcpToolDescriptor[]
  descriptorJson?: string
}

export function webMcpDescriptorDigest(descriptorJson: string): string {
  return createHash('sha256').update('hronaut-webmcp-descriptor-v1\0').update(descriptorJson).digest('hex')
}

function pageBridgeSource(mode: 'status' | 'list' | 'call', payload: Record<string, unknown> = {}): string {
  return `(${function webMcpPageBridge(
    mode: string,
    payload: Record<string, unknown>,
    limits: typeof WEBMCP_LIMITS
  ) {
    const api = (document as unknown as {
      modelContext?: {
        getTools: () => Promise<unknown[]>
        executeTool: (tool: Record<string, unknown>, input: unknown, options?: { signal: AbortSignal }) => Promise<unknown>
      }
    }).modelContext
    if (!api || typeof api.getTools !== 'function' || typeof api.executeTool !== 'function') {
      return { supported: false, reason: 'document.modelContext is unavailable in this page' }
    }
    if (mode === 'status') return { supported: true }

    const safeMessage = (error: unknown): string => {
      const value = error instanceof Error ? error.message : String(error)
      return value.slice(0, 500)
    }
    const canonical = (value: unknown): string => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value)
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
      const record = value as Record<string, unknown>
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
    }
    const normalize = (tools: unknown[]): { descriptors: unknown[]; descriptorJson: string; raw: Record<string, unknown>[] } => {
      const topLevel = tools.filter((candidate): candidate is Record<string, unknown> => {
        if (!candidate || typeof candidate !== 'object') return false
        const tool = candidate as Record<string, unknown>
        return tool.window === window && tool.origin === location.origin
      })
      if (topLevel.length > limits.maxTools) throw new Error(`The page exposes more than ${limits.maxTools} top-level WebMCP tools`)
      const entries = topLevel.map((tool) => {
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
        if (tool.inputSchema !== undefined) {
          let inputSchema = tool.inputSchema
          if (typeof inputSchema === 'string') {
            try {
              inputSchema = JSON.parse(inputSchema)
            } catch {
              throw new Error(`WebMCP tool ${tool.name} has an invalid JSON input schema`)
            }
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
        return { descriptor, tool }
      }).sort((left, right) => String(left.descriptor.name).localeCompare(String(right.descriptor.name)))
      const names = entries.map(entry => entry.descriptor.name)
      if (new Set(names).size !== names.length) throw new Error('The page exposes duplicate top-level WebMCP tool names')
      const descriptors = entries.map(entry => entry.descriptor)
      return { descriptors, descriptorJson: canonical(descriptors), raw: entries.map(entry => entry.tool) }
    }
    const boundedResult = (value: unknown): { value: unknown; truncated?: true } => {
      const seen = new WeakSet<object>()
      let truncated = false
      const visit = (candidate: unknown, depth: number): unknown => {
        if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') return candidate
        if (typeof candidate === 'string') {
          if (candidate.length <= 20_000) return candidate
          truncated = true
          return candidate.slice(0, 20_000)
        }
        if (typeof candidate === 'bigint') return candidate.toString()
        if (typeof candidate !== 'object') return String(candidate)
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

    return Promise.resolve(api.getTools()).then(async (tools: unknown[]): Promise<Record<string, unknown>> => {
      const listing = normalize(tools)
      if (mode === 'list') return { supported: true, descriptors: listing.descriptors, descriptorJson: listing.descriptorJson }
      if (listing.descriptorJson !== payload.descriptorJson) {
        return { supported: true, status: 'STALE_DESCRIPTOR', dispatch: 'not-dispatched', effects: 'none' }
      }
      const index = listing.descriptors.findIndex((descriptor: unknown) => (
        descriptor && typeof descriptor === 'object' && (descriptor as Record<string, unknown>).name === payload.toolName
      ))
      if (index < 0) return { supported: true, status: 'TOOL_REMOVED', dispatch: 'not-dispatched', effects: 'none' }
      const controller = new AbortController()
      let timeoutId = 0
      const timeout = new Promise(resolve => {
        timeoutId = window.setTimeout(() => {
          controller.abort()
          resolve({ __hronautTimeout: true })
        }, limits.timeoutMs)
      })
      // Chromium 152's origin-trial implementation exposes inputSchema as a
      // string and accepts a JSON string here. The current draft exposes the
      // parsed schema and accepts the input object directly.
      const executionInput = (payload.legacyInputEncoding === true
        || listing.raw.some(tool => typeof tool.inputSchema === 'string'))
        ? JSON.stringify(payload.arguments ?? {})
        : payload.arguments ?? {}
      const outcome = await Promise.race([
        Promise.resolve(api.executeTool(listing.raw[index]!, executionInput, { signal: controller.signal }))
          .then((value: unknown) => ({ __hronautResult: value }))
          .catch((error: unknown) => ({ __hronautError: safeMessage(error) })),
        timeout
      ]) as Record<string, unknown>
      clearTimeout(timeoutId)
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
    }).catch((error: unknown) => ({ supported: true, status: 'WEBMCP_ERROR', dispatch: 'not-dispatched', effects: 'none', error: safeMessage(error) }))
  }.toString()})(${JSON.stringify(mode)},${JSON.stringify(payload)},${JSON.stringify(WEBMCP_LIMITS)})`
}

export function webMcpStatusScript(): string {
  return pageBridgeSource('status')
}

export function webMcpListScript(): string {
  return pageBridgeSource('list')
}

export function webMcpCallScript(input: {
  descriptorJson: string
  toolName: string
  arguments: Record<string, unknown>
}): string {
  return pageBridgeSource('call', { ...input, legacyInputEncoding: legacyWebMcpInputEncoding })
}
