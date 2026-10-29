import { DEFAULT_FONT_SIZE_LIMITS, isDefaultFontSize } from '../../../shared/default-font-size.js'
import { normalizeTabLabel } from '../../../shared/tab-label.js'
import { MAX_BROWSER_TABS, type BrowserState, type NewTabOptions } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl, normalizeAddress } from '../url.js'
import type { Browser } from '../browser.js'
import { assertTabLabelAdmission, saveTabLabel } from '../tab-labels/tab-labels.js'
import { ensureHumanWorkspace } from '../workspace-creation/human-workspace.js'
import { assertWorkspaceNavigationAllowed } from '../workspace-navigation/workspace-navigation.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState } from '../browser-state/browser-state.js'

/** The tab manager's tab limit. */
const MAX_TABS = MAX_BROWSER_TABS

/**
 * Opens an agent's website tab in its workspace and saves its label, admitted
 * before creation yields so later edits and lifecycle copies queue behind it.
 * The created tab stays the agent's even when the label is not saved. It is
 * not shown: Follow agents shows it through the agent's call on it, so it
 * waits as for any call, such as while a page fills the window.
 */
export async function newLabeledAgentTab(browser: Browser, options: NewTabOptions, value: string, validateAuthority: () => void, onCreated: (id: string) => void, onCreationAttempt: () => void): Promise<{ createdTabId: string; labelPersistence: 'saved' | 'durability-unconfirmed' | 'not-saved' }> {
  const label = normalizeTabLabel(value)
  assertTabLabelAdmission(browser)
  if (!options.mcpGroupId || isHronautHomeUrl(normalizeAddress(options.url ?? 'about:blank', browser.options.getSearchEngine?.()))) throw new Error('Labeled agent tabs require an agent workspace and a website address.')
  validateAuthority()
  let createdTabId: string | undefined
  let committed = false
  let saving: Promise<'saved' | 'durability-unconfirmed' | 'not-saved'> | undefined
  try {
    await createNewTab(browser, options, false, tab => {
      createdTabId = tab.id
      // Admit before createTab yields, so later edits and lifecycle copies see
      // this save on the same queue. The label is staged, not yet visible.
      saving = saveTabLabel(browser, tab.id, label ?? '', validateAuthority, () => { committed = true })
        .then(result => result.status, () => committed ? 'durability-unconfirmed' as const : 'not-saved' as const)
      onCreated(tab.id)
    }, onCreationAttempt)
  } finally {
    // Even a synchronous creation observer failure cannot release ownership
    // while the admitted write is still queued or running.
    if (saving) await saving
  }
  if (!createdTabId || !saving) throw new Error('Labeled tab creation did not produce a website tab.')
  return { createdTabId, labelPersistence: await saving }
}

/**
 * Opens a tab at the address, in the given workspace or the person's; Home
 * opens as the application page instead. A workspace created only for this tab
 * is closed again when the tab fails.
 */
export async function createNewTab(browser: Browser, options: NewTabOptions, selectVisible: boolean, onCreated?: (tab: BrowserTab) => void, onCreationAttempt?: () => void): Promise<BrowserState> {
  const url = normalizeAddress(options.url ?? 'about:blank', browser.options.getSearchEngine?.())
  if (isHronautHomeUrl(url)) {
    if (options.mcpGroupId) throw new LocalizedError('appErrors.tabs.homeInAgentWorkspace')
    return browser.openHome()
  }
  if (browser.tabs.size >= MAX_TABS) throw new LocalizedError('appErrors.tabs.limit', { max: MAX_TABS })
  if (options.defaultFontSize !== undefined && !isDefaultFontSize(options.defaultFontSize)) {
    throw new Error(`defaultFontSize must be an integer from ${DEFAULT_FONT_SIZE_LIMITS.min} to ${DEFAULT_FONT_SIZE_LIMITS.max} CSS pixels`)
  }
  const createsWorkspace = !options.mcpGroupId && browser.mcpTabGroups.size === 0
  const groupId = options.mcpGroupId ?? ensureHumanWorkspace(browser)
  browser.requireMcpTabGroup(groupId)
  assertWorkspaceNavigationAllowed(browser, groupId, url, 'direct')
  try {
    await browser.createTab({
      url,
      active: options.active ?? true,
      selectVisible,
      mcpGroupId: groupId,
      focus: options.focus,
      zoomIsolated: options.zoomIsolated === true,
      defaultFontSize: options.defaultFontSize,
      loadsInTurn: options.loadsInTurn === true && options.active === false,
      onCreated,
      onCreationAttempt
    })
  } catch (error) {
    if (createsWorkspace) {
      try { await browser.closeMcpTabGroup(groupId) } catch (cleanupError) {
        throw new LocalizedError('appErrors.tabs.workspaceCleanupFailed', undefined, { cause: new AggregateError([error, cleanupError]) })
      }
    }
    throw error
  }
  return browserState(browser)
}
