import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
// The prototype-built browsers below stub changed and getState; the pause functions publish through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
import { Browser } from '../src/main/browser/browser.js'
import { setAllAgentsPaused, setTabAgentPaused } from '../src/main/browser/agent-pause/agent-pause.js'

// The fake browser below stubs the functions the code under test calls; these reach its stubs.
vi.mock('../src/main/browser/page-navigation/page-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-navigation/page-navigation.js')>(),
  stop: (browser: { stop: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.stop(...args)
}))

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
  const manager = Object.assign(Object.create(Browser.prototype), {
    tabs, allAgentsPaused: false, agentPauseOverridesAllowed: true, globallyResumedAgentTabIds: new Set<string>(),
    liveRegionRecorder: { release: vi.fn() }, cssStatePreview: { clear: vi.fn(async () => undefined) }, virtualPasskeys: { stop: vi.fn() },
    logpoints: { stop: vi.fn() },
    changed: vi.fn(), getState: () => ({ tabs: [] })
  }) as Browser
  return { manager, tab }
}

it('marks a take over and hands the tab back with a note of what the person did', () => {
  const { manager, tab } = fixture()
  setTabAgentPaused(manager, tab.id, true, { takeOver: true })
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
  expect(tab.takeOver?.at).toBe(1_000_000)
  // Pausing the tab ends a virtual passkey the agent started in it.
  expect((manager as unknown as { virtualPasskeys: { stop: ReturnType<typeof vi.fn> } }).virtualPasskeys.stop).toHaveBeenCalledWith(tab, 'authority-changed')
  // And its logpoints, whose values a person using the tab could reveal.
  expect((manager as unknown as { logpoints: { stop: ReturnType<typeof vi.fn> } }).logpoints.stop).toHaveBeenCalledWith(tab, 'authority-changed')
  // A second take over keeps the first mark, so the note covers the whole time.
  vi.setSystemTime(1_005_000)
  setTabAgentPaused(manager, tab.id, true, { takeOver: true })
  expect(tab.takeOver?.at).toBe(1_000_000)
  tab.url = 'https://shop.example/checkout?order=98765'
  tab.navigationGeneration += 1
  tab.humanInteractionGeneration += 2
  vi.setSystemTime(1_030_000)
  setTabAgentPaused(manager, tab.id, false)
  expect(manager.isTabTakenOver(tab.id)).toBe(false)
  expect(tab.takeOver).toBeUndefined()
  const note = (to: string) => `The person had this tab for 30 s and handed it back. The page moved from https://shop.example/cart to ${to}. `
    + 'They clicked or typed in the page. Read the page again before you continue.'
  // The page moved, so agents kept from URL detail get a note of their own, without the query.
  expect(tab.handedBack).toEqual({ at: 1_030_000, note: note('https://shop.example/checkout?order=98765'), noteWithoutUrlDetail: note('https://shop.example/checkout') })
  // The next take over starts afresh.
  setTabAgentPaused(manager, tab.id, true, { takeOver: true })
  expect(tab.handedBack).toBeUndefined()
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
})

it('keeps a plain pause apart from a take over, and takes over a tab already paused', () => {
  const { manager, tab } = fixture()
  setTabAgentPaused(manager, tab.id, true)
  expect(manager.isTabTakenOver(tab.id)).toBe(false)
  setTabAgentPaused(manager, tab.id, false)
  expect(tab.handedBack).toBeUndefined()
  setTabAgentPaused(manager, tab.id, true)
  setTabAgentPaused(manager, tab.id, true, { takeOver: true })
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
})

it('hands the tab back when resuming all agents ends the take over, but not while they stay paused', () => {
  const { manager, tab } = fixture()
  setAllAgentsPaused(manager, true)
  setTabAgentPaused(manager, tab.id, true, { takeOver: true })
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
  // The tab's own setting was never paused, so resuming everyone resumes it too.
  setAllAgentsPaused(manager, false)
  expect(manager.isTabTakenOver(tab.id)).toBe(false)
  expect(tab.takeOver).toBeUndefined()
  expect(tab.handedBack?.note).toMatch(/^The person had this tab for 0 s and handed it back\./)

  // A tab taken over on its own stays with the person through a pause of everyone and its end.
  setTabAgentPaused(manager, tab.id, true, { takeOver: true })
  setAllAgentsPaused(manager, true, false)
  setAllAgentsPaused(manager, false)
  expect(manager.isTabTakenOver(tab.id)).toBe(true)
})
