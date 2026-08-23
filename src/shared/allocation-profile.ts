import type { BrowserMemoryAllocationHotspot } from './types.js'

export const ALLOCATION_PROFILE_LIMITS = {
  maxHotspots: 50,
  maxFunctionNameChars: 200
} as const

export interface CdpSamplingHeapProfileNode {
  id: number
  callFrame: {
    functionName?: string
    url?: string
    lineNumber?: number
    columnNumber?: number
  }
  selfSize: number
  children?: CdpSamplingHeapProfileNode[]
}

export interface CdpSamplingHeapProfile {
  head: CdpSamplingHeapProfileNode
  samples?: Array<{
    size: number
    nodeId: number
    ordinal?: number
  }>
}

export interface BrowserMemoryAllocationSummary {
  sampledBytes: number
  sampleCount: number
  hotspots: BrowserMemoryAllocationHotspot[]
  truncated: boolean
}

function boundedFunctionName(value: string | undefined): string {
  const normalized = (value || '(anonymous)').replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || '(anonymous)'
  return normalized.slice(0, ALLOCATION_PROFILE_LIMITS.maxFunctionNameChars)
}

function walkNodes(node: CdpSamplingHeapProfileNode, visit: (node: CdpSamplingHeapProfileNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walkNodes(child, visit)
}

export function summarizeAllocationProfile(
  profile: CdpSamplingHeapProfile,
  sanitizeUrl: (url: string) => string = (url) => url
): BrowserMemoryAllocationSummary {
  const sampleCounts = new Map<number, number>()
  for (const sample of profile.samples ?? []) {
    sampleCounts.set(sample.nodeId, (sampleCounts.get(sample.nodeId) ?? 0) + 1)
  }

  const groups = new Map<string, BrowserMemoryAllocationHotspot>()
  walkNodes(profile.head, (node) => {
    const selfBytes = Number.isFinite(node.selfSize) ? Math.max(0, Math.round(node.selfSize)) : 0
    const samples = sampleCounts.get(node.id) ?? 0
    if (!selfBytes && !samples) return
    const functionName = boundedFunctionName(node.callFrame.functionName)
    const rawUrl = String(node.callFrame.url ?? '')
    const url = rawUrl ? sanitizeUrl(rawUrl) : undefined
    const rawLine = node.callFrame.lineNumber
    const rawColumn = node.callFrame.columnNumber
    const lineNumber = Number.isInteger(rawLine) && rawLine! >= 0 ? rawLine! + 1 : undefined
    const columnNumber = Number.isInteger(rawColumn) && rawColumn! >= 0 ? rawColumn! + 1 : undefined
    const key = `${functionName}\u0000${url ?? ''}\u0000${lineNumber ?? ''}\u0000${columnNumber ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.selfBytes += selfBytes
      existing.samples += samples
    } else {
      groups.set(key, {
        functionName,
        ...(url ? { url } : {}),
        ...(lineNumber !== undefined ? { lineNumber } : {}),
        ...(columnNumber !== undefined ? { columnNumber } : {}),
        selfBytes,
        selfPercent: 0,
        samples
      })
    }
  })

  const sampledBytes = [...groups.values()].reduce((total, entry) => total + entry.selfBytes, 0)
  const sorted = [...groups.values()]
    .sort((left, right) => right.selfBytes - left.selfBytes || right.samples - left.samples || left.functionName.localeCompare(right.functionName))
  const hotspots = sorted.slice(0, ALLOCATION_PROFILE_LIMITS.maxHotspots).map((entry) => ({
    ...entry,
    selfPercent: sampledBytes > 0 ? Math.round((entry.selfBytes / sampledBytes) * 10_000) / 100 : 0
  }))

  return {
    sampledBytes,
    sampleCount: (profile.samples ?? []).length,
    hotspots,
    truncated: sorted.length > ALLOCATION_PROFILE_LIMITS.maxHotspots
  }
}
