import type { Browser } from '../browser/browser.js'
import { buildBrowserState } from '../browser/browser-state/browser-state.js'
import { isHronautHomeUrl } from '../browser/url.js'
import { closeTabsForPerson } from '../browser/tab-close/close-tabs-for-person.js'
import { selectTabForPerson } from '../browser/tab-selection/person-tab-switch.js'
import { setTabPinned } from '../browser/tab-arrangement/tab-arrangement.js'
import { saveTabLabel } from '../browser/tab-labels/tab-labels.js'
import { reopenClosedTab } from '../browser/tab-reopening/tab-reopening.js'
import { deleteSavedTabGroup, restoreSavedTabGroup } from '../browser/workspace-archive/workspace-archive.js'
import { newTab } from '../browser/new-tabs/open-new-tab.js'
import { LocalizedError } from '../localized-error.js'
import { HOME_CARD_ICON_MAX_LENGTH } from '../../shared/home-workspaces.js'
import { emulationSummary } from '../../shared/emulation-description.js'
import { shownTabIsHome } from '../browser/home-tabs/home-tabs.js'
import type { BrowserTabState } from '../../shared/types.js'
import { validHomeTabAction, type HomeTabsState } from '../../shared/home-tabs.js'

/** A site icon small enough for Home, as Home's workspace cards take it; larger ones show the generic icon instead. */
function homeIcon(value: string | undefined): string | undefined {
  return value && value.length <= HOME_CARD_ICON_MAX_LENGTH && value.startsWith('data:image/') ? value : undefined
}

/** An address as Home shows it: a web address keeps no user name or password written into it. */
function shownUrl(value: string): string {
  if (!/^https?:/iu.test(value)) return value
  try {
    const url = new URL(value)
    if (!url.username && !url.password) return value
    url.username = ''
    url.password = ''
    return url.href
  } catch {
    return value
  }
}

/** The revision of the frame main would answer for the tab, which Home compares with the one it holds. */
function previewRevision(browser: Browser, tab: BrowserTabState): number | undefined {
  if (tab.sleeping) return browser.tabOverviewSleepPreviews.get(tab.id)?.revision
  const frame = browser.tabOverviewPreviews.get(tab.id)
  return frame?.navigationGeneration === tab.navigationGeneration ? frame.revision : undefined
}

/**
 * The open website tabs, recently closed tabs and archived workspaces Home's Tabs view lists: page labels and the
 * conditions its cards name, without diagnostics, page contents or form values. It goes to Home, never to the shell as
 * an action's reply, so a change waiting to be published waits on (see StatePublication.beforeRead).
 */
export function homeTabsState(browser: Browser): HomeTabsState {
  const state = buildBrowserState(browser)
  const tabs = state.tabs.filter(tab => !isHronautHomeUrl(tab.url))
  const previous = browser.previousPageTabId
  return {
    workspaces: state.mcpTabGroups.map(({ id, name, color }) => ({ id, name, color })),
    tabs: tabs.map(tab => {
      const faviconDataUrl = homeIcon(tab.faviconDataUrl)
      const revision = previewRevision(browser, tab)
      return {
        id: tab.id,
        ...(tab.mcpGroupId ? { workspaceId: tab.mcpGroupId } : {}),
        title: tab.title,
        ...(tab.label ? { label: tab.label } : {}),
        url: shownUrl(tab.url),
        ...(faviconDataUrl ? { faviconDataUrl } : {}),
        loading: tab.loading,
        sleeping: tab.sleeping,
        ...(tab.labelDurabilityUnconfirmed ? { labelDurabilityUnconfirmed: true } : {}),
        pinned: tab.pinned,
        muted: tab.muted,
        audible: tab.audible,
        locked: tab.humanInteractionInputLocked ?? (state.allHumanInteractionLocked || tab.humanInteractionLocked),
        agentActive: browser.mcpActivitiesByTab.has(tab.id),
        ...(tab.emulation ? { emulation: emulationSummary(tab.emulation) } : {}),
        ...(tab.networkRouteCount ? { networkRouteCount: tab.networkRouteCount } : {}),
        navigationGeneration: tab.navigationGeneration,
        ...(revision !== undefined ? { previewRevision: revision } : {})
      }
    }),
    previousTabId: previous && tabs.some(tab => tab.id === previous) ? previous : null,
    closedTabs: state.closedTabs.map(tab => ({
      id: tab.id,
      title: tab.title,
      ...(tab.label ? { label: tab.label } : {}),
      url: shownUrl(tab.url),
      pinned: tab.pinned,
      closedAt: tab.closedAt
    })),
    archivedWorkspaces: state.savedTabGroups.map(group => ({
      id: group.id,
      name: group.name,
      color: group.color,
      deletionProtected: group.deletionProtected === true,
      tabs: group.tabs.map(tab => ({ title: tab.title, ...(tab.label ? { label: tab.label } : {}), url: shownUrl(tab.url) }))
    })),
    locked: state.allHumanInteractionLocked
  }
}

/**
 * Does what Home's Tabs view asked, as the same control in the tab strip or Settings does it, and answers with the
 * tabs after it. Opening, reopening or restoring shows that page, so Home goes out of view.
 */
export async function runHomeTabAction(browser: Browser, input: unknown): Promise<HomeTabsState> {
  const action = validHomeTabAction(input)
  const tab = 'tabId' in action ? browser.tabs.get(action.tabId) : undefined
  if ('tabId' in action && (!tab || isHronautHomeUrl(tab.url))) throw new LocalizedError('native.errors.tabUnavailable')
  switch (action.kind) {
    case 'open': await selectTabForPerson(browser, action.tabId); break
    case 'close': await closeTabsForPerson(browser, [action.tabId]); break
    case 'pin': await setTabPinned(browser, action.tabId, action.pinned); break
    case 'label': await saveTabLabel(browser, action.tabId, action.label); break
    case 'reopen': await reopenClosedTab(browser, action.closedTabId); break
    case 'restore': await restoreSavedTabGroup(browser, action.workspaceId); break
    case 'delete':
      // Deleting checks that the workspace is still archived and unprotected; a locked browser keeps it as well.
      if (buildBrowserState(browser).allHumanInteractionLocked) throw new LocalizedError('appErrors.workspace.deleteLocked')
      await deleteSavedTabGroup(browser, action.workspaceId)
      break
    case 'back': {
      // Only from Home: a tab chosen meanwhile, by the person or an agent, is not undone by a late Escape.
      const previous = browser.previousPageTabId ? browser.tabs.get(browser.previousPageTabId) : undefined
      if (previous && !isHronautHomeUrl(previous.url) && shownTabIsHome(browser)) await selectTabForPerson(browser, previous.id)
      break
    }
    case 'new-tab': await newTab(browser, { active: true }); break
  }
  return homeTabsState(browser)
}
