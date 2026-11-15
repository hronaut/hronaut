import { createHash } from 'node:crypto'
import { pageScript } from '../../shared/page-script.js'
import { webMcpBridgeInPage } from './webmcp-bridge.page.js'

export const WEBMCP_LIMITS = {
  maxTools: 32,
  maxNameChars: 128,
  maxTitleChars: 256,
  maxDescriptionChars: 2_000,
  maxSchemaChars: 32_000,
  // Deeper than any tool's input schema needs, and shallow enough for main to read and write one without running out
  // of stack.
  maxSchemaDepth: 64,
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
  status?: string
  descriptorJson?: string
}

export function webMcpDescriptorDigest(descriptorJson: string): string {
  return createHash('sha256').update('hronaut-webmcp-descriptor-v1\0').update(descriptorJson).digest('hex')
}

function pageBridgeSource(mode: 'status' | 'list' | 'call', payload: Record<string, unknown> = {}): string {
  return pageScript(webMcpBridgeInPage, mode, payload, WEBMCP_LIMITS)
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
