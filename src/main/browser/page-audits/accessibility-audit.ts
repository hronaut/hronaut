import { accessibilityAuditPageScript, normalizeAccessibilityAuditOptions } from '../../../shared/accessibility-audit.js'
import { accessibilityBaselineSummary, buildAccessibilityComparison } from '../../../shared/accessibility-comparison.js'
import type { BrowserAccessibilityAudit, BrowserAccessibilityAuditOptions } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { isHronautHomeUrl } from '../url.js'
import type { PageAuditsAccess, PageAuditsTab } from './page-audits-access.js'

const ACCESSIBILITY_AUDIT_WORLD_ID = ISOLATED_WORLDS.accessibilityAudit

/**
 * Runs axe-core on the tab's page in its isolated world, and sets, clears or
 * compares with the tab's accessibility baseline. It throws when the page
 * navigated or the baseline changed while the audit was pending.
 */
export async function accessibilityAudit<Tab extends PageAuditsTab>(access: PageAuditsAccess<Tab>, options: BrowserAccessibilityAuditOptions = {}): Promise<BrowserAccessibilityAudit> {
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before running an accessibility audit')
  const navigationGeneration = tab.navigationGeneration
  const normalized = normalizeAccessibilityAuditOptions(options)
  const baselineGeneration = normalized.action === 'measure'
    ? undefined
    : ++tab.accessibilityBaselineGeneration
  const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
    ACCESSIBILITY_AUDIT_WORLD_ID,
    [{ code: accessibilityAuditPageScript(access.axeSource(), normalized) }],
    false
  ) as Omit<
    BrowserAccessibilityAudit,
    'tabId' | 'action' | 'standard' | 'scope' | 'baseline' | 'comparison' | 'baselineCleared'
  >
  const current = access.findTab(tab.id)
  if (
    !current
    || current !== tab
    || current.webContents.isDestroyed()
    || current.navigationGeneration !== navigationGeneration
  ) {
    throw new Error('The page changed during the accessibility audit. Run a fresh audit.')
  }
  if (
    baselineGeneration !== undefined
    && tab.accessibilityBaselineGeneration !== baselineGeneration
  ) {
    throw new Error('Accessibility baseline changed while the audit was pending. Run the requested action again.')
  }
  const audit: BrowserAccessibilityAudit = {
    ...result,
    tabId: tab.id,
    action: normalized.action,
    standard: normalized.standard,
    scope: {
      selector: normalized.selector ?? null,
      maxViolations: normalized.maxViolations,
      maxNodesPerViolation: normalized.maxNodesPerViolation
    }
  }
  if (normalized.action === 'clear-baseline') {
    const baselineCleared = Boolean(tab.accessibilityBaseline)
    tab.accessibilityBaseline = undefined
    return { ...audit, baselineCleared }
  }
  if (normalized.action === 'set-baseline') {
    tab.accessibilityBaseline = { ...audit, action: 'measure' }
    return { ...audit, baseline: accessibilityBaselineSummary(audit) }
  }
  const baseline = tab.accessibilityBaseline
  return baseline
    ? {
        ...audit,
        baseline: accessibilityBaselineSummary(baseline),
        comparison: buildAccessibilityComparison(baseline, audit)
      }
    : audit
}
