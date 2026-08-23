import type { BrowserCpuProfileHotspot } from './types.js'

export const CPU_PROFILE_LIMITS = {
  maxHotspots: 50,
  maxFunctionNameChars: 200
} as const

export interface CdpCpuProfileNode {
  id: number
  callFrame: {
    functionName?: string
    url?: string
    lineNumber?: number
    columnNumber?: number
  }
}

export interface CdpCpuProfile {
  nodes: CdpCpuProfileNode[]
  startTime: number
  endTime: number
  samples?: number[]
  timeDeltas?: number[]
}

export interface BrowserCpuProfileSummary {
  durationMs: number
  sampledTimeMs: number
  sampleCount: number
  hotspots: BrowserCpuProfileHotspot[]
  truncated: boolean
}

function boundedFunctionName(value: string | undefined): string {
  const normalized = (value || '(anonymous)').replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || '(anonymous)'
  return normalized.slice(0, CPU_PROFILE_LIMITS.maxFunctionNameChars)
}

function roundedMilliseconds(microseconds: number): number {
  return Math.round((microseconds / 1_000) * 100) / 100
}

export function summarizeCpuProfile(
  profile: CdpCpuProfile,
  sanitizeUrl: (url: string) => string = (url) => url
): BrowserCpuProfileSummary {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  const groups = new Map<string, {
    functionName: string
    url?: string
    lineNumber?: number
    columnNumber?: number
    selfTimeUs: number
    samples: number
  }>()

  let sampledTimeUs = 0
  for (let index = 0; index < samples.length; index += 1) {
    const node = nodes.get(samples[index]!)
    if (!node) continue
    const delta = Number.isFinite(deltas[index]) && deltas[index]! > 0 ? deltas[index]! : 0
    sampledTimeUs += delta
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
      existing.selfTimeUs += delta
      existing.samples += 1
    } else {
      groups.set(key, { functionName, url, lineNumber, columnNumber, selfTimeUs: delta, samples: 1 })
    }
  }

  const sorted = [...groups.values()]
    .sort((left, right) => right.selfTimeUs - left.selfTimeUs || right.samples - left.samples || left.functionName.localeCompare(right.functionName))
  const hotspots = sorted.slice(0, CPU_PROFILE_LIMITS.maxHotspots).map((entry) => ({
    functionName: entry.functionName,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.lineNumber !== undefined ? { lineNumber: entry.lineNumber } : {}),
    ...(entry.columnNumber !== undefined ? { columnNumber: entry.columnNumber } : {}),
    selfTimeMs: roundedMilliseconds(entry.selfTimeUs),
    selfPercent: sampledTimeUs > 0 ? Math.round((entry.selfTimeUs / sampledTimeUs) * 10_000) / 100 : 0,
    samples: entry.samples
  }))

  return {
    durationMs: roundedMilliseconds(Math.max(0, profile.endTime - profile.startTime)),
    sampledTimeMs: roundedMilliseconds(sampledTimeUs),
    sampleCount: samples.length,
    hotspots,
    truncated: sorted.length > CPU_PROFILE_LIMITS.maxHotspots
  }
}
