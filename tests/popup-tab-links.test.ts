import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
// The browser below answers workspaceNavigationAllowed, which a page navigating its tab asks.
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  workspaceNavigationAllowed: (browser: { workspaceNavigationAllowed: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.workspaceNavigationAllowed(...args)
}))
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'
import { sleepBlockReason } from '../src/main/browser/tab-sleep/tab-sleep.js'

// A sign-in popup and the page that opened it can reach each other's windows. Putting either to sleep replaced its
// page and broke the sign-in, and the other page could then load any address into the sleeping tab, past the
// workspace's Site access rules, while Hronaut still showed the tab asleep on its old address.

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

function websiteTab(id: string, openerTabId?: string) {
  return {
    id, url: `https://${id}.example/`, pinned: false, sleeping: false, loading: false, audible: false,
    pageLifecycleState: 'active', webContents: { id: id.length, isDestroyed: () => false, isDevToolsOpened: () => false },
    ...(openerTabId ? { openerTabId } : {})
  }
}

function sleepBrowser(tabs: Array<ReturnType<typeof websiteTab>>) {
  const byId = new Map(tabs.map(tab => [tab.id, tab]))
  return {
    tabs: byId,
    activeTabId: 'shown',
    splitViewContains: () => false,
    options: {},
    devToolsOpening: new Set(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    agentInputWebContents: new Map(),
    videoRecorder: { state: () => ({ status: 'idle' }) },
    cssStatePreview: { active: () => false },
    domMutationSource: { active: () => false },
    virtualPasskeys: { active: () => false },
    logpoints: { active: () => false },
    mcpActivitiesByTab: new Map(),
    downloadController: { hasActiveDownload: () => false },
    renderQueues: new Map(),
    remove: (tabId: string) => byId.delete(tabId)
  }
}

describe('putting a popup or the tab that opened it to sleep', () => {
  it('keeps both awake while the other is open', () => {
    const app = websiteTab('app')
    const popup = websiteTab('popup', 'app')
    const other = websiteTab('other')
    const browser = sleepBrowser([app, popup, other])
    expect(sleepBlockReason(browser as never, app as never)).toBe('appErrors.sleep.window')
    expect(sleepBlockReason(browser as never, popup as never)).toBe('appErrors.sleep.window')
    expect(sleepBlockReason(browser as never, other as never)).toBeUndefined()
  })

  it('lets either sleep once the other is closed', () => {
    const app = websiteTab('app')
    const popup = websiteTab('popup', 'app')
    const browser = sleepBrowser([app, popup])
    browser.remove('app')
    expect(sleepBlockReason(browser as never, popup as never)).toBeUndefined()
    const reopened = sleepBrowser([app])
    expect(sleepBlockReason(reopened as never, app as never)).toBeUndefined()
  })
})

describe('a page navigating a sleeping tab', () => {
  function page(policyAllows: boolean) {
    const contents = new EventEmitter()
    const tab = { id: 'popup', url: 'https://popup.example/', sleeping: true, mcpGroupId: 'client', navigationPolicyDenialSequence: 0 }
    const workspaceNavigationAllowed = vi.fn(() => policyAllows)
    const fallback = anything() as Record<string | symbol, unknown>
    const browser = new Proxy({}, { get: (_target, key) => key === 'workspaceNavigationAllowed' ? workspaceNavigationAllowed : fallback[key] })
    attachNavigationEvents(browser as never, tab as never, contents as never)
    const navigate = (url: string, isMainFrame = true) => {
      const preventDefault = vi.fn()
      contents.emit('will-frame-navigate', { url, isMainFrame, preventDefault })
      return preventDefault
    }
    return { tab, navigate, workspaceNavigationAllowed }
  }

  it('is refused, even to an address the workspace allows', () => {
    const { navigate } = page(true)
    expect(navigate('https://elsewhere.example/')).toHaveBeenCalled()
  })

  it('leaves frames inside the page, and an awake tab, to the workspace policy', () => {
    const { tab, navigate, workspaceNavigationAllowed } = page(true)
    expect(navigate('https://frame.example/', false)).not.toHaveBeenCalled()
    tab.sleeping = false
    expect(navigate('https://elsewhere.example/')).not.toHaveBeenCalled()
    expect(workspaceNavigationAllowed).toHaveBeenCalledWith('client', 'https://elsewhere.example/', 'page')
  })
})
