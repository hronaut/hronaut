import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { shareWindowOpenerPause } from '../src/main/browser/agent-pause/agent-pause.js'

// A sign-in popup and the tab that opened it can read each other's pages when they are on the same site. Taking
// over the popup to type a password left the agent in the other tab free to read what was typed.

type Tab = {
  id: string; url: string; tabAgentPaused: boolean; nativeInputEnvironmentGeneration: number
  navigationGeneration: number; humanInteractionGeneration: number; openerTabId?: string
  takeOver?: { at: number }; handedBack?: { at: number; note: string }
}

function pageTab(id: string, openerTabId?: string): Tab {
  return {
    id, url: `https://${id}.example/`, tabAgentPaused: false, nativeInputEnvironmentGeneration: 0,
    navigationGeneration: 0, humanInteractionGeneration: 0, ...(openerTabId ? { openerTabId } : {})
  }
}

function fixture(...tabList: Tab[]) {
  const tabs = new Map(tabList.map(tab => [tab.id, tab]))
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    tabs, allAgentsPaused: false, agentPauseOverridesAllowed: true, globallyResumedAgentTabIds: new Set<string>(),
    liveRegionRecorder: { release: vi.fn() }, cssStatePreview: { clear: vi.fn(async () => undefined) }, virtualPasskeys: { stop: vi.fn() },
    logpoints: { stop: vi.fn() },
    changed: vi.fn(), getTab: (tabId: string) => tabs.get(tabId)!, getState: () => ({ tabs: [] })
  }) as BrowserTabsManager
  const paused = () => [...tabs.keys()].filter(tabId => manager.isTabAgentPaused(tabId))
  return { manager, tabs, paused }
}

it('pauses the agent in a popup and the tab that opened it together, and hands back only the tab taken over', () => {
  const app = pageTab('app')
  const popup = pageTab('popup', 'app')
  const { manager, paused } = fixture(app, popup, pageTab('other'))
  manager.setTabAgentPaused('popup', true, { takeOver: true })
  expect(paused()).toEqual(['app', 'popup'])
  expect(manager.isTabTakenOver('popup')).toBe(true)
  expect(manager.isTabTakenOver('app')).toBe(false)
  // Resuming from the other tab resumes both, and the agent hears what happened in the popup.
  manager.setTabAgentPaused('app', false)
  expect(paused()).toEqual([])
  expect(popup.takeOver).toBeUndefined()
  expect(popup.handedBack?.note).toMatch(/^The person had this tab for /)
  expect(app.handedBack).toBeUndefined()
})

it('reaches a popup the popup opened, and stops sharing once a tab is closed', () => {
  const { manager, tabs, paused } = fixture(pageTab('app'), pageTab('popup', 'app'), pageTab('second', 'popup'))
  manager.setTabAgentPaused('second', true)
  expect(paused()).toEqual(['app', 'popup', 'second'])
  manager.setTabAgentPaused('app', false)
  tabs.delete('popup')
  manager.setTabAgentPaused('second', true)
  expect(paused()).toEqual(['second'])
})

it('shares an exception to a global pause too', () => {
  const { manager, paused } = fixture(pageTab('app'), pageTab('popup', 'app'), pageTab('other'))
  manager.setAllAgentsPaused(true)
  manager.setTabAgentPaused('popup', false)
  expect(paused()).toEqual(['other'])
  manager.setTabAgentPaused('app', true)
  expect(paused()).toEqual(['app', 'popup', 'other'])
})

it('starts a popup with the pause of the tab that opened it', () => {
  const { manager, tabs } = fixture(pageTab('app'))
  const access = (manager as unknown as { agentPauseAccess(): Parameters<typeof shareWindowOpenerPause>[0] }).agentPauseAccess()
  manager.setTabAgentPaused('app', true)
  const popup = pageTab('popup', 'app')
  tabs.set(popup.id, popup)
  shareWindowOpenerPause(access, popup as never)
  expect(manager.isTabAgentPaused('popup')).toBe(true)

  manager.setAllAgentsPaused(true)
  manager.setTabAgentPaused('app', false)
  const second = pageTab('second', 'app')
  tabs.set(second.id, second)
  shareWindowOpenerPause(access, second as never)
  expect(manager.isTabAgentPaused('second')).toBe(false)
})
