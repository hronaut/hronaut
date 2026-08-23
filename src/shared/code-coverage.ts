import type { BrowserCodeCoverageResource } from './types.js'

export const CODE_COVERAGE_LIMITS = {
  maxResources: 100,
  maxSourceCharacters: 5_000_000
} as const

export interface CoverageRange {
  startOffset: number
  endOffset: number
  count: number
}

interface CoverageBoundary extends CoverageRange {
  kind: 'open' | 'close'
}

function boundedOffset(value: number, sourceLength: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(sourceLength, Math.max(0, Math.round(value)))
}

export function coverageByteUsage(source: string, ranges: CoverageRange[]): { totalBytes: number; usedBytes: number } {
  const totalBytes = Buffer.byteLength(source)
  if (!source.length || !ranges.length) return { totalBytes, usedBytes: 0 }

  const boundaries: CoverageBoundary[] = []
  for (const range of ranges) {
    const startOffset = boundedOffset(range.startOffset, source.length)
    const endOffset = boundedOffset(range.endOffset, source.length)
    if (endOffset <= startOffset) continue
    const normalized = { startOffset, endOffset, count: Math.max(0, Math.round(range.count)) }
    boundaries.push({ ...normalized, kind: 'open' }, { ...normalized, kind: 'close' })
  }
  boundaries.sort((left, right) => {
    if (left.startOffset !== right.startOffset && left.kind === 'open' && right.kind === 'open') {
      return left.startOffset - right.startOffset
    }
    const leftOffset = left.kind === 'open' ? left.startOffset : left.endOffset
    const rightOffset = right.kind === 'open' ? right.startOffset : right.endOffset
    if (leftOffset !== rightOffset) return leftOffset - rightOffset
    if (left.kind !== right.kind) return left.kind === 'close' ? -1 : 1
    if (left.kind === 'open') return right.endOffset - left.endOffset
    return right.startOffset - left.startOffset
  })

  const stack: CoverageBoundary[] = []
  const used: Array<{ start: number; end: number }> = []
  const firstBoundary = boundaries[0]
  let previousOffset = firstBoundary
    ? (firstBoundary.kind === 'open' ? firstBoundary.startOffset : firstBoundary.endOffset)
    : 0
  for (const boundary of boundaries) {
    const offset = boundary.kind === 'open' ? boundary.startOffset : boundary.endOffset
    if (offset > previousOffset && (stack.at(-1)?.count ?? 0) > 0) {
      const previous = used.at(-1)
      if (previous?.end === previousOffset) previous.end = offset
      else used.push({ start: previousOffset, end: offset })
    }
    if (boundary.kind === 'open') {
      stack.push(boundary)
    } else {
      let index = -1
      for (let candidateIndex = stack.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        const candidate = stack[candidateIndex]!
        if (candidate.startOffset === boundary.startOffset && candidate.endOffset === boundary.endOffset) {
          index = candidateIndex
          break
        }
      }
      if (index >= 0) stack.splice(index, 1)
    }
    previousOffset = offset
  }

  const usedBytes = used.reduce((total, range) => total + Buffer.byteLength(source.slice(range.start, range.end)), 0)
  return { totalBytes, usedBytes: Math.min(totalBytes, usedBytes) }
}

export function summarizeCoverageResources(resources: BrowserCodeCoverageResource[]): {
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
  javascript: { resourceCount: number; totalBytes: number; usedBytes: number; unusedBytes: number }
  css: { resourceCount: number; totalBytes: number; usedBytes: number; unusedBytes: number }
} {
  const summaryFor = (type: BrowserCodeCoverageResource['type']) => {
    const matching = resources.filter((resource) => resource.type === type)
    const totalBytes = matching.reduce((total, resource) => total + resource.totalBytes, 0)
    const usedBytes = matching.reduce((total, resource) => total + resource.usedBytes, 0)
    return {
      resourceCount: matching.length,
      totalBytes,
      usedBytes,
      unusedBytes: Math.max(0, totalBytes - usedBytes)
    }
  }
  const javascript = summaryFor('javascript')
  const css = summaryFor('css')
  const totalBytes = javascript.totalBytes + css.totalBytes
  const usedBytes = javascript.usedBytes + css.usedBytes
  return {
    totalBytes,
    usedBytes,
    unusedBytes: Math.max(0, totalBytes - usedBytes),
    usedPercent: totalBytes ? Math.round((usedBytes / totalBytes) * 10_000) / 100 : 0,
    javascript,
    css
  }
}
