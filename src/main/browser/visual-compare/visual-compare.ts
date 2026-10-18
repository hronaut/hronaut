import { nativeImage } from 'electron'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type {
  BrowserVisualCompareAction,
  BrowserVisualCompareOptions,
  BrowserVisualCompareReport,
  BrowserVisualCompareScope
} from '../../../shared/types.js'
import { compareBgraBitmaps, normalizeVisualCompareClip, normalizeVisualCompareThreshold } from '../../../shared/visual-compare.js'
import type { VisualCompareAccess, VisualCompareTab } from './visual-compare-access.js'

const MAX_VISUAL_COMPARE_SETTLE_MS = 2_000

export interface BrowserVisualCompareResult {
  report: BrowserVisualCompareReport
  diffPng?: Buffer
}

function visualCompareCaveats(threshold: number, urlsDiffer = false, scope?: BrowserVisualCompareScope): string[] {
  return [
    scope?.kind === 'region'
      ? 'Only the selected viewport CSS rectangle is compared. Complete native pixels inside it are cropped before normalization to at most 1920 x 1080 pixels. The denominator and diff bounds refer to the cropped normalized bitmap; unchanged does not describe the rest of the page.'
      : 'The baseline, current capture, and diff cover the visible viewport only and are normalized to at most 1920 x 1080 pixels.',
    ...(scope?.kind === 'region' ? ['Region comparisons require unchanged viewport, zoom, device pixel ratio, scroll position and document. Cropping is not anonymization; review image contents before sharing.'] : []),
    `A pixel is marked changed when any native bitmap channel differs by more than ${threshold}; animations, caret blinking, video, and delayed content can create noise.`,
    'Generate the baseline and comparison in the same Hronaut environment; browser, operating-system, font, and GPU differences can change rendering.',
    'Baseline and diff images stay only in memory and are discarded when cleared, when the tab closes, or when Hronaut exits.',
    ...(urlsDiffer ? ['The page URL changed after the baseline; this is a cross-navigation comparison.'] : [])
  ]
}

/**
 * Clears, reads, sets or compares the tab's in-memory visual baseline. The
 * baseline and the latest diff stay on the tab, so the tab manager's
 * navigation and close handling stay authoritative for discarding them.
 */
export async function visualCompare<Tab extends VisualCompareTab>(access: VisualCompareAccess<Tab>, options: BrowserVisualCompareOptions, validateCapture?: () => void): Promise<BrowserVisualCompareResult> {
  const tab = access.getTab(options.tabId)
  const action: BrowserVisualCompareAction = options.action
  const requestedClip = normalizeVisualCompareClip(options.clip)
  if (requestedClip && action !== 'set-baseline') throw new Error('Provide clip only when setting a new visual baseline')
  const threshold = normalizeVisualCompareThreshold(options.threshold)
  const rawSettleMs = options.settleMs ?? 200
  if (!Number.isFinite(rawSettleMs)) throw new TypeError('Visual comparison settleMs must be finite')
  const settleMs = Math.min(MAX_VISUAL_COMPARE_SETTLE_MS, Math.max(0, Math.round(rawSettleMs)))
  const baseReport = {
    action,
    tabId: tab.id,
    title: tab.title,
    url: tab.webContents.getURL() || tab.url,
    threshold
  }

  if (action === 'clear') {
    tab.visualComparisonGeneration += 1
    tab.visualComparison = undefined
    return {
      report: {
        ...baseReport,
        status: 'empty',
        cleared: true,
        caveats: visualCompareCaveats(threshold)
      }
    }
  }

  if (action === 'get') {
    const comparison = tab.visualComparison
    if (!comparison) {
      return {
        report: {
          ...baseReport,
          status: 'empty',
          caveats: visualCompareCaveats(threshold)
        }
      }
    }
    if (comparison.lastReport) {
      return {
        report: { ...comparison.lastReport, action: 'get' },
        ...(comparison.diffPng ? { diffPng: comparison.diffPng } : {})
      }
    }
    return {
      report: {
        ...baseReport,
        status: 'baseline',
        baseline: comparison.baseline.snapshot,
        scope: comparison.baseline.snapshot.scope,
        caveats: visualCompareCaveats(threshold, false, comparison.baseline.snapshot.scope)
      }
    }
  }

  const operationGeneration = ++tab.visualComparisonGeneration
  const retained = tab.visualComparison?.baseline
  if (action === 'compare' && !retained) throw new Error('Set a visual baseline before comparing the page')
  const clip = action === 'set-baseline' ? requestedClip : retained?.snapshot.scope?.kind === 'region' ? retained.snapshot.scope.clip : undefined
  const current = await access.captureVisual(tab, settleMs, clip)
  if (access.findTab(tab.id) !== tab || tab.visualComparisonGeneration !== operationGeneration) {
    throw new Error('Visual comparison changed while the page capture was pending. Run the requested action again.')
  }
  if (snapshotDeltaInvalidationReason(current.observationContext, access.snapshotDeltaContext(tab))) throw new Error('The page changed while the visual capture was pending. Capture it again.')
  // MCP supplies its existing live authority checks before retaining image state.
  validateCapture?.()
  if (action === 'set-baseline') {
    tab.visualComparison = { baseline: { snapshot: current.snapshot, png: current.png, navigationGeneration: current.navigationGeneration } }
    return {
      report: {
        ...baseReport,
        url: current.snapshot.url,
        status: 'baseline',
        baseline: current.snapshot,
        scope: current.snapshot.scope,
        caveats: visualCompareCaveats(threshold, false, current.snapshot.scope)
      }
    }
  }

  const comparison = tab.visualComparison
  if (!comparison) throw new Error('Set a visual baseline before comparing the page')
  if (comparison.baseline.snapshot.scope?.kind === 'region'
    && (comparison.baseline.navigationGeneration !== current.navigationGeneration
      || JSON.stringify(comparison.baseline.snapshot.context) !== JSON.stringify(current.snapshot.context)
      || JSON.stringify(comparison.baseline.snapshot.scope) !== JSON.stringify(current.snapshot.scope))) {
    throw new Error('The region capture context changed (viewport, zoom, pixel ratio, scroll or document); set a new visual baseline')
  }
  const baselineImage = nativeImage.createFromBuffer(comparison.baseline.png)
  if (baselineImage.isEmpty()) throw new Error('The visual baseline could not be decoded; set it again')
  const baselineSize = baselineImage.getSize()
  if (baselineSize.width !== current.snapshot.width || baselineSize.height !== current.snapshot.height) {
    throw new Error(
      `The viewport changed from ${baselineSize.width} x ${baselineSize.height} to ${current.snapshot.width} x ${current.snapshot.height}; set a new baseline at this size`
    )
  }
  const baselineBitmap = Buffer.from(baselineImage.toBitmap({ scaleFactor: 1 }))
  const diff = compareBgraBitmaps(
    baselineBitmap,
    current.bitmap,
    current.snapshot.width,
    current.snapshot.height,
    threshold
  )
  const diffPng = nativeImage.createFromBitmap(diff.bitmap, {
    width: current.snapshot.width,
    height: current.snapshot.height,
    scaleFactor: 1
  }).toPNG()
  const report: BrowserVisualCompareReport = {
    ...baseReport,
    url: current.snapshot.url,
    status: 'compared',
    baseline: comparison.baseline.snapshot,
    current: current.snapshot,
    scope: current.snapshot.scope,
    identical: diff.changedPixels === 0,
    changedPixels: diff.changedPixels,
    totalPixels: diff.totalPixels,
    changedPercent: diff.changedPercent,
    ...(diff.bounds ? { diffBounds: diff.bounds } : {}),
    caveats: visualCompareCaveats(threshold, comparison.baseline.snapshot.url !== current.snapshot.url, current.snapshot.scope)
  }
  comparison.lastReport = report
  comparison.diffPng = diffPng
  return { report, diffPng }
}

/** The diff PNG from the tab's latest visual comparison. */
export function visualDiff<Tab extends VisualCompareTab>(access: VisualCompareAccess<Tab>, tabId?: string): Buffer {
  const diff = access.getTab(tabId).visualComparison?.diffPng
  if (!diff) throw new Error('Compare the current page with a visual baseline first')
  return diff
}
