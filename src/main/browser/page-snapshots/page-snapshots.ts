import { randomUUID } from 'node:crypto'
import { searchSnapshot, type SnapshotSearchOptions, type SnapshotSearchResult } from '../../../shared/snapshot-search.js'
import type { BrowserSnapshot } from '../../../shared/snapshot.js'
import {
  classifyBrowserObservationQuality,
  normalizeObservationExpectedOrigin,
  observationQualityPageScript,
  type BrowserObservationQualityResult,
  type BrowserObservationQualitySignals
} from '../../../shared/observation-quality.js'
import { BROWSER_SNAPSHOT_FORMAT_VERSION, boundedSnapshotDelta, snapshotDeltaInvalidationReason, type BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import { urlWithoutDetail } from '../../../shared/url-detail.js'
import { LocalizedError } from '../../localized-error.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { snapshotScript } from '../page-scripts.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/** A tab's snapshot baseline: the snapshot later deltas compare with, and the context it was captured in. */
export interface BrowserSnapshotBaselineRecord {
  context: BrowserSnapshotDeltaContext
  snapshot: BrowserSnapshot
  rootSelector?: string
}

const MAX_SNAPSHOT_BASELINES = 64

const OBSERVATION_QUALITY_WORLD_ID = ISOLATED_WORLDS.observationQuality

const SNAPSHOT_WORLD_ID = ISOLATED_WORLDS.snapshot

/** Control names kept per page for the shell's plain-words agent steps. */
const AGENT_STEP_NAMES_LIMIT = 1_000

/** The text of a snapshot of the tab's page. */
export async function snapshot(browser: Browser, tabId?: string, maxChars = 30_000): Promise<string> {
  return (await snapshotDetails(browser, tabId, maxChars)).text
}

/**
 * Captures a snapshot of the tab's page, or of one component of it, in the
 * snapshot's isolated world, and keeps the names of the controls it showed
 * for the shell. It throws when the tab or its observation context changed
 * during the capture.
 */
export async function snapshotDetails(browser: Browser, tabId?: string, maxChars = 30_000, rootSelector?: string): Promise<BrowserSnapshot> {
  const tab = getTab(browser, tabId)
  if (rootSelector !== undefined && (!rootSelector.trim() || rootSelector.length > 512)) {
    throw new TypeError('Snapshot root must be a non-empty CSS selector of at most 512 characters')
  }
  const context = browser.snapshotDeltaContext(tab)
  const omitUrlDetail = browser.options.getOmitAgentUrlDetail?.() === true
  // The isolated world retains control identity across captures of one
  // document without exposing it to, or accepting it from, page JavaScript.
  const snapshot = await tab.webContents.executeJavaScriptInIsolatedWorld(
    SNAPSHOT_WORLD_ID,
    [{ code: snapshotScript(Math.min(Math.max(maxChars, 1_000), 100_000), true, rootSelector, omitUrlDetail) }],
    false
  ) as BrowserSnapshot & { scopeError?: string; targetNames?: unknown }
  if (snapshot.scopeError) {
    const messages: Record<string, string> = {
      'invalid-selector': 'Snapshot root selector is not valid CSS',
      'missing-root': 'Snapshot root was not found; capture a fresh target',
      'ambiguous-root': 'Snapshot root must match exactly one element',
      'unsupported-root': 'Snapshot root must be a non-editable light-DOM component, not a form control or frame',
      'hidden-root': 'Snapshot root is not visible; choose a visible component',
      'visibility-limit': 'Snapshot root visibility exceeded its observation limit; choose a smaller component',
      'detached-root': 'Snapshot root detached during capture; capture a fresh target'
    }
    throw new Error(messages[snapshot.scopeError] ?? 'Snapshot root could not be captured')
  }
  if (snapshot.formatVersion !== BROWSER_SNAPSHOT_FORMAT_VERSION) {
    throw new LocalizedError('appErrors.pageTools.snapshotFormatChanged')
  }
  const current = findTab(browser, tab.id)
  if (!current || current !== tab || current.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.pageTools.snapshotTabChanged')
  }
  const invalidation = snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(current))
  if (invalidation) {
    // Agents read which part of the context changed; a person reads that the page changed.
    throw new LocalizedError('appErrors.pageTools.snapshotContextChanged', undefined, {
      message: `The snapshot context changed during observation (${invalidation}). Capture a fresh snapshot.`
    })
  }
  const { targetNames, ...captured } = snapshot
  rememberAgentStepNames(current, targetNames)
  const published = omitUrlDetail ? { ...captured, urlDetail: 'omitted' as const } : captured
  return rootSelector === undefined ? published : { ...published, captureId: randomUUID() }
}

/**
 * Keeps the names of the controls a snapshot showed the agent, so the shell can say Clicking "Review order"
 * for a later click on that ref. Each capture replaces them: it also takes the refs of earlier captures off
 * the page. They never go back to agents.
 */
function rememberAgentStepNames(tab: BrowserTab, targetNames: unknown): void {
  const names = new Map<string, string>()
  if (Array.isArray(targetNames)) {
    for (const entry of targetNames.slice(0, AGENT_STEP_NAMES_LIMIT)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || !/^e\d{1,7}$/.test(entry[0])) continue
      names.set(entry[0], entry[1].slice(0, 120))
    }
  }
  tab.agentStepNames = { documentGeneration: tab.walletNavigationGeneration, names }
}

/**
 * The name the latest snapshot of this page showed for a control ref, for the shell's plain-words steps.
 * The tab defaults to the one a workspace tool would use. Loading another document forgets the names;
 * a route change within the page keeps them, as it keeps the refs.
 */
export function agentStepName(browser: Browser, workspaceId: string, tabId: string | undefined, ref: string): string | undefined {
  const group = browser.mcpTabGroups.get(workspaceId)
  if (!group) return undefined
  const tab = findTab(browser, tabId
    ?? (group.activeTabId && findTab(browser, group.activeTabId)?.mcpGroupId === workspaceId ? group.activeTabId : undefined)
    ?? [...browser.tabs.values()].find((candidate) => candidate.mcpGroupId === workspaceId)?.id
    ?? '')
  if (!tab || tab.mcpGroupId !== workspaceId) return undefined
  const names = tab.agentStepNames
  return names?.documentGeneration === tab.walletNavigationGeneration ? names.names.get(ref) : undefined
}

/**
 * Classifies how well the tab's page can be observed now, from signals read
 * in its isolated world. It throws when the tab or its observation context
 * changed during the assessment.
 */
export async function observationQuality(browser: Browser, options: {
  tabId?: string
  expectedOrigin?: string
  expectedText?: string
  expectedSelector?: string
} = {}): Promise<BrowserObservationQualityResult> {
  const tab = getTab(browser, options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before assessing observation quality')
  const challengeDetectionEnabled = browser.options.getChallengeDetectionEnabled?.() === true
  // Read once, so the address and its marker agree.
  const omitUrlDetail = browser.options.getOmitAgentUrlDetail?.() === true
  const shownUrl = (url: string): string => omitUrlDetail ? urlWithoutDetail(url) : redactNetworkUrl(url)
  const marked = (result: BrowserObservationQualityResult): BrowserObservationQualityResult => omitUrlDetail ? { ...result, urlDetail: 'omitted' } : result
  const expectedOrigin = normalizeObservationExpectedOrigin(options.expectedOrigin)
  const unavailableState = tab.pageProblem
    ? 'unavailable' as const
    : tab.webContents.isLoadingMainFrame() ? 'loading' as const : undefined
  if (unavailableState) {
    return marked(classifyBrowserObservationQuality({
      resolvedUrl: shownUrl(tab.url),
      contentType: '',
      pageState: unavailableState,
      visibleTextChars: 0,
      primaryTextChars: 0,
      noiseTextChars: 0,
      headingCount: 0,
      interactiveCount: 0,
      challengeSignals: [],
      loginSignals: [],
      soft404Signals: [],
      cookieSignals: []
    }, {
      challengeDetectionEnabled,
      expectedOrigin,
      expectedTextProvided: options.expectedText !== undefined,
      expectedSelectorProvided: options.expectedSelector !== undefined
    }))
  }
  const context = browser.snapshotDeltaContext(tab)
  const signals = await tab.webContents.executeJavaScriptInIsolatedWorld(
    OBSERVATION_QUALITY_WORLD_ID,
    [{ code: observationQualityPageScript({ challengeDetectionEnabled, expectedText: options.expectedText, expectedSelector: options.expectedSelector }) }],
    false
  ) as BrowserObservationQualitySignals
  const current = findTab(browser, tab.id)
  if (!current || current !== tab || current.webContents.isDestroyed()) {
    throw new Error('The observation tab changed during assessment. Assess the page again.')
  }
  const invalidation = snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(current))
  if (invalidation) {
    throw new Error(`The observation context changed during assessment (${invalidation}). Assess the page again.`)
  }
  return marked(classifyBrowserObservationQuality(
    { ...signals, resolvedUrl: shownUrl(signals.resolvedUrl) },
    {
      challengeDetectionEnabled,
      expectedOrigin,
      expectedTextProvided: options.expectedText !== undefined,
      expectedSelectorProvided: options.expectedSelector !== undefined
    }
  ))
}

/**
 * Captures a snapshot as the tab's baseline for later deltas, replacing the
 * tab's earlier baseline and evicting the oldest baselines over the limit.
 */
export async function setSnapshotBaseline(browser: Browser, tabId?: string, maxChars = 30_000, rootSelector?: string) {
  const tab = getTab(browser, tabId)
  const operationGeneration = ++tab.snapshotBaselineGeneration
  const snapshot = await snapshotDetails(browser, tab.id, maxChars, rootSelector)
  const current = findTab(browser, tab.id)
  if (
    !current
    || current !== tab
    || current.webContents.isDestroyed()
    || current.snapshotBaselineGeneration !== operationGeneration
  ) {
    throw new Error('Snapshot baseline changed while capture was pending. Run the requested action again.')
  }
  const context = browser.snapshotDeltaContext(current)
  deleteSnapshotBaselineForTab(browser, tab.id)
  while (browser.snapshotBaselines.size >= MAX_SNAPSHOT_BASELINES) {
    const oldestId = browser.snapshotBaselines.keys().next().value as string | undefined
    if (!oldestId) break
    const oldest = browser.snapshotBaselines.get(oldestId)
    browser.snapshotBaselines.delete(oldestId)
    if (oldest && browser.snapshotBaselineIdsByTab.get(oldest.context.tabId) === oldestId) {
      browser.snapshotBaselineIdsByTab.delete(oldest.context.tabId)
    }
  }
  const baselineId = randomUUID()
  browser.snapshotBaselines.set(baselineId, { context, snapshot, rootSelector: rootSelector?.trim() })
  browser.snapshotBaselineIdsByTab.set(tab.id, baselineId)
  return { action: 'set-baseline' as const, status: 'baseline' as const, baselineId, context, ...snapshot }
}

/** Clears the tab's baseline, or only the named one, and invalidates baseline captures still pending. */
export function clearSnapshotBaseline(browser: Browser, tabId?: string, baselineId?: string) {
  const tab = getTab(browser, tabId)
  const currentId = browser.snapshotBaselineIdsByTab.get(tab.id)
  const cleared = Boolean(currentId && (!baselineId || baselineId === currentId))
  if (!baselineId || baselineId === currentId) tab.snapshotBaselineGeneration += 1
  if (cleared) deleteSnapshotBaselineForTab(browser, tab.id)
  return {
    action: 'clear-baseline' as const,
    status: 'cleared' as const,
    baselineId: baselineId ?? currentId ?? null,
    cleared
  }
}

/**
 * The changes since a baseline snapshot, or why the baseline no longer
 * applies. Unless told not to, a complete delta advances the baseline to the
 * new snapshot.
 */
export async function snapshotDelta(browser: Browser, options: {
  tabId?: string
  baselineId: string
  rootSelector?: string
  maxOutputChars?: number
  advanceBaseline?: boolean
}) {
  const tab = getTab(browser, options.tabId)
  const context = browser.snapshotDeltaContext(tab)
  const baseline = browser.snapshotBaselines.get(options.baselineId)
  const maxOutputChars = options.maxOutputChars ?? 12_000
  if (!baseline) {
    return {
      action: 'delta' as const,
      status: 'invalidated' as const,
      baselineId: options.baselineId,
      context,
      invalidationReason: 'baseline-not-found' as const,
      maxOutputChars,
      truncated: false,
      changes: []
    }
  }
  const invalidationReason = snapshotDeltaInvalidationReason(baseline.context, context)
    ?? (options.rootSelector !== undefined && options.rootSelector.trim() !== baseline.rootSelector
      ? 'scope-changed' as const : undefined)
  if (invalidationReason) {
    return {
      action: 'delta' as const,
      status: 'invalidated' as const,
      baselineId: options.baselineId,
      context,
      invalidationReason,
      maxOutputChars,
      truncated: false,
      changes: []
    }
  }
  const advanceGeneration = options.advanceBaseline === false
    ? undefined
    : ++tab.snapshotBaselineGeneration

  let snapshot: BrowserSnapshot
  try {
    snapshot = await snapshotDetails(browser, tab.id, baseline.snapshot.maxChars, baseline.rootSelector)
  } catch (error) {
    const current = findTab(browser, tab.id)
    if (current && !current.webContents.isDestroyed()) {
      const changedDuringCapture = snapshotDeltaInvalidationReason(
        baseline.context,
        browser.snapshotDeltaContext(current)
      )
      if (changedDuringCapture) {
        return {
          action: 'delta' as const,
          status: 'invalidated' as const,
          baselineId: options.baselineId,
          context: browser.snapshotDeltaContext(current),
          invalidationReason: changedDuringCapture,
          maxOutputChars,
          truncated: false,
          changes: []
        }
      }
    }
    throw error
  }
  if (
    advanceGeneration !== undefined
    && (
      findTab(browser, tab.id) !== tab
      || tab.snapshotBaselineGeneration !== advanceGeneration
      || browser.snapshotBaselineIdsByTab.get(tab.id) !== options.baselineId
      || browser.snapshotBaselines.get(options.baselineId) !== baseline
    )
  ) {
    throw new Error('Snapshot baseline changed while delta capture was pending. Run the requested action again.')
  }
  // The person changed whether the URL line carries its detail: comparing the two lines would repeat the detail
  // they chose to omit, or report a change the page never made.
  if (snapshot.urlDetail !== baseline.snapshot.urlDetail) {
    return {
      action: 'delta' as const,
      status: 'invalidated' as const,
      baselineId: options.baselineId,
      context,
      invalidationReason: 'snapshot-format' as const,
      maxOutputChars,
      truncated: false,
      changes: []
    }
  }
  const { text, ...sourceSnapshot } = snapshot
  const result = boundedSnapshotDelta(baseline.snapshot.text, text, maxOutputChars, {
    action: 'delta',
    baselineId: options.baselineId,
    context,
    sourceSnapshot,
    baselineAdvanced: false,
    authorityGranted: false
  })
  if (options.advanceBaseline !== false && result.truncated === false) {
    baseline.context = context
    baseline.snapshot = snapshot
    result.baselineAdvanced = true
  }
  return result
}

/** Forgets the tab's baseline. */
export function deleteSnapshotBaselineForTab(browser: Browser, tabId: string): void {
  const baselineId = browser.snapshotBaselineIdsByTab.get(tabId)
  if (baselineId) browser.snapshotBaselines.delete(baselineId)
  browser.snapshotBaselineIdsByTab.delete(tabId)
}

/** Searches a full-size snapshot of the tab's page, or of one component of it, for text. */
export async function findSnapshot(browser: Browser, options: SnapshotSearchOptions & { tabId?: string; rootSelector?: string }): Promise<SnapshotSearchResult & { tabId: string; sourceSnapshot: Omit<BrowserSnapshot, 'text'> }> {
  const tab = getTab(browser, options.tabId)
  const snapshot = options.rootSelector === undefined
    ? await snapshotDetails(browser, tab.id, 100_000)
    : await snapshotDetails(browser, tab.id, 100_000, options.rootSelector)
  const { text, ...sourceSnapshot } = snapshot
  const result = searchSnapshot(text, {
    query: options.query,
    caseSensitive: options.caseSensitive,
    maxMatches: options.maxMatches,
    contextChars: options.contextChars
  })
  if (snapshot.scope) result.caveats.push('Matches describe only the selected component plus page URL/title context; absence does not establish absence elsewhere on the page.')
  return { tabId: tab.id, sourceSnapshot, ...result }
}
