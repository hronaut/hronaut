import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

afterEach(() => { vi.useRealTimers() })

type Tab = {
  id: string; url: string; tabAgentPaused: boolean; nativeInputEnvironmentGeneration: number
  navigationGeneration: number; humanInteractionGeneration: number
  takeOver?: { at: number }; handedBack?: { at: number; note: string; noteWithoutUrlDetail?: string }
}

function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000_000)
  const tab: Tab = {
    id: 'tab', url: 'https://shop.example/cart', tabAgentPaused: false, nativeInputEnvironmentGeneration: 0,
    navigationGeneration: 3, humanInteractionGeneration: 7
  }
  const tabs = new Map([[tab.id, tab]])
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    tabs, allAgentsPaused: false, agentPauseOverridesAllowed: true, globallyResumedAgentTabIds: new Set<string>(),
    liveRegionRecorder: { release: vi.fn() }, cssStatePreview: { clear: vi.fn(async () => undefined) },
    changed: vi.fn(), getTab: () => tab, getState: () => ({ tabs: [] })
  }) as BrowserTabsManager
  return { manager, tab }
}

it('marks a take over and hands the tab back with a note of what the person did', () => {
  const { manager, tab } = fixture()
  manager.setTabAgentPaused(tab.id, true, { takeOver: true })
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
  expect(tab.takeOver?.at).toBe(1_000_000)
  // A second take over keeps the first mark, so the note covers the whole time.
  vi.setSystemTime(1_005_000)
  manager.setTabAgentPaused(tab.id, true, { takeOver: true })
  expect(tab.takeOver?.at).toBe(1_000_000)
  tab.url = 'https://shop.example/checkout'
  tab.navigationGeneration += 1
  tab.humanInteractionGeneration += 2
  vi.setSystemTime(1_030_000)
  manager.setTabAgentPaused(tab.id, false)
  expect(manager.isTabTakenOver(tab.id)).toBe(false)
  expect(tab.takeOver).toBeUndefined()
  const note = 'The person had this tab for 30 s and handed it back. The page moved from https://shop.example/cart to https://shop.example/checkout. '
    + 'They clicked or typed in the page. Read the page again before you continue.'
  // The page moved, so agents that are kept from URL detail get a note of their own, here with the same addresses.
  expect(tab.handedBack).toEqual({ at: 1_030_000, note, noteWithoutUrlDetail: note })
  // The next take over starts afresh.
  manager.setTabAgentPaused(tab.id, true, { takeOver: true })
  expect(tab.handedBack).toBeUndefined()
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
})

it('keeps a plain pause apart from a take over, and takes over a tab already paused', () => {
  const { manager, tab } = fixture()
  manager.setTabAgentPaused(tab.id, true)
  expect(manager.isTabTakenOver(tab.id)).toBe(false)
  manager.setTabAgentPaused(tab.id, false)
  expect(tab.handedBack).toBeUndefined()
  manager.setTabAgentPaused(tab.id, true)
  manager.setTabAgentPaused(tab.id, true, { takeOver: true })
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
})

it('hands the tab back when resuming all agents ends the take over, but not while they stay paused', () => {
  const { manager, tab } = fixture()
  manager.setAllAgentsPaused(true)
  manager.setTabAgentPaused(tab.id, true, { takeOver: true })
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
  // The tab's own setting was never paused, so resuming everyone resumes it too.
  manager.setAllAgentsPaused(false)
  expect(manager.isTabTakenOver(tab.id)).toBe(false)
  expect(tab.takeOver).toBeUndefined()
  expect(tab.handedBack?.note).toMatch(/^The person had this tab for 0 s and handed it back\./)

  // A tab taken over on its own stays with the person through a pause of everyone and its end.
  manager.setTabAgentPaused(tab.id, true, { takeOver: true })
  manager.setAllAgentsPaused(true, false)
  manager.setAllAgentsPaused(false)
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
})
