import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { redactTypedText } from '../../shared/person-typed-text.js'
import type { PersonTypedText } from '../browser/person-typed-text/person-typed-text-store.js'

/**
 * The workspaces a call names: its `workspaceId`, another `…WorkspaceId` such as a copy's source, or `workspaceIds`;
 * undefined for a call that names none, which may show any workspace.
 */
export function calledWorkspaces(input: unknown): string[] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const ids = Object.entries(input).flatMap(([key, value]) => {
    if (key === 'workspaceIds' && Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string')
    return /^(?:workspaceId|\w+WorkspaceId)$/.test(key) && typeof value === 'string' ? [value] : []
  })
  return ids.length ? ids : undefined
}

function typedTextPatternFor(manager: unknown, input: unknown): RegExp | null {
  return (manager as { personTypedText?: PersonTypedText } | undefined)?.personTypedText?.pattern(calledWorkspaces(input)) ?? null
}

/**
 * Runs an agent's call and gives its result with what the person typed hidden (see redactPersonTypedResult). A call
 * that throws throws with the same hidden in its message, which the client reads as the call's error.
 */
export async function hidePersonTypedText(manager: unknown, input: unknown, call: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return redactPersonTypedResult(manager, input, await call())
  } catch (error) {
    const pattern = typedTextPatternFor(manager, input)
    if (pattern && error instanceof Error) error.message = redactTypedText(error.message, pattern)
    throw error
  }
}

function redactedValue(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactedValue(item, redact))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactedValue(item, redact)]))
}

/**
 * The result of an agent's call with what the person typed in the workspaces it names, or in any for a call that names
 * none, as [redacted]: in its text, the text of a resource it holds, and its structured content. Images and audio stay
 * as they are; a screenshot shows the page as it looks.
 */
export function redactPersonTypedResult(manager: unknown, input: unknown, result: CallToolResult): CallToolResult {
  const pattern = typedTextPatternFor(manager, input)
  if (!pattern || !Array.isArray(result?.content)) return result
  const redact = (text: string): string => redactTypedText(text, pattern)
  return {
    ...result,
    content: result.content.map((part) => {
      if (part.type === 'text') return { ...part, text: redact(part.text) }
      if (part.type === 'resource' && 'text' in part.resource) return { ...part, resource: { ...part.resource, text: redact(part.resource.text) } }
      return part
    }),
    ...(result.structuredContent ? { structuredContent: redactedValue(result.structuredContent, redact) as CallToolResult['structuredContent'] } : {})
  }
}
