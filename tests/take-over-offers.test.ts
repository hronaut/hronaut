import { describe, expect, it, vi } from 'vitest'
import type { AgentPresence } from '../src/shared/agent-presence.js'
import { TAKE_OVER_OFFER_INTERVAL_MS, TakeOverOffers, tabAgentPauseOptions } from '../src/main/agents/take-over-offers.js'

function agent(name: string, overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: `key-${name}`, name, initial: name.slice(0, 1), colorIndex: 0, state: 'working', step: 'click', recentSteps: [], lastTabId: 'tab-a', ...overrides }
}

function fixture() {
  let now = 10_000
  const workspaces: Record<string, AgentPresence[]> = { work: [agent('Claude Code'), agent('Cursor', { lastTabId: 'tab-b' })] }
  const paused = new Set<string>()
  const takenOver = new Set<string>()
  const setTabAgentPaused = vi.fn((tabId: string, pause: boolean, options?: { takeOver?: boolean }) => {
    if (pause) paused.add(tabId)
    else paused.delete(tabId)
    if (pause && options?.takeOver) takenOver.add(tabId)
    if (!pause) takenOver.delete(tabId)
  })
  const sendOffer = vi.fn()
  const onError = vi.fn()
  const offers = new TakeOverOffers({
    agents: (workspaceId) => workspaces[workspaceId],
    isTabAgentPaused: (tabId) => paused.has(tabId),
    isTabTakenOver: (tabId) => takenOver.has(tabId),
    setTabAgentPaused,
    sendOffer,
    onError,
    now: () => now
  })
  return { offers, workspaces, paused, takenOver, setTabAgentPaused, sendOffer, onError, advance: (ms: number) => { now += ms } }
}

describe('take-over offers in main', () => {
  it('offers a take over only on a tab an agent is working on and that is not paused', () => {
    const f = fixture()
    expect(f.offers.available('tab-a', 'work')?.name).toBe('Claude Code')
    expect(f.offers.available('tab-a', undefined)).toBeUndefined()
    expect(f.offers.available('tab-c', 'work')).toBeUndefined()
    f.workspaces.work![0] = agent('Claude Code', { state: 'idle' })
    expect(f.offers.available('tab-a', 'work')).toBeUndefined()
    expect(f.offers.available('tab-b', 'work')?.name).toBe('Cursor')
    f.paused.add('tab-b')
    expect(f.offers.available('tab-b', 'work')).toBeUndefined()
    // Presence that cannot be read offers nothing.
    const broken = new TakeOverOffers({
      agents: () => { throw new Error('stopped') },
      isTabAgentPaused: () => false,
      isTabTakenOver: () => false,
      setTabAgentPaused: vi.fn(),
      sendOffer: vi.fn()
    })
    expect(broken.available('tab-a', 'work')).toBeUndefined()
  })

  it('tells the shell at most once a second while the person keeps typing, and again at once after a pause', () => {
    const f = fixture()
    f.offers.touched('tab-a', 'work')
    f.advance(TAKE_OVER_OFFER_INTERVAL_MS - 1)
    f.offers.touched('tab-a', 'work')
    expect(f.sendOffer.mock.calls).toEqual([[{ tabId: 'tab-a', clientKey: 'key-Claude Code' }]])
    // Another tab or agent is a new offer.
    f.offers.touched('tab-b', 'work')
    expect(f.sendOffer).toHaveBeenCalledTimes(2)
    f.advance(1)
    f.offers.touched('tab-a', 'work')
    expect(f.sendOffer).toHaveBeenCalledTimes(3)
    f.offers.paused('tab-a')
    f.offers.touched('tab-a', 'work')
    expect(f.sendOffer).toHaveBeenCalledTimes(4)
    f.offers.touched('tab-c', 'work')
    expect(f.sendOffer).toHaveBeenCalledTimes(4)
  })

  it('takes over exactly the tab whose page got the key, and nothing once no agent works there', () => {
    const f = fixture()
    expect(f.offers.takeOverFromPage('tab-b', 'work')).toBe(true)
    expect(f.setTabAgentPaused.mock.calls).toEqual([['tab-b', true, { takeOver: true }]])
    expect(f.offers.takeOverFromPage('tab-b', 'work')).toBe(false)
    f.workspaces.work = []
    expect(f.offers.takeOverFromPage('tab-a', 'work')).toBe(false)
    expect(f.setTabAgentPaused).toHaveBeenCalledOnce()
    // A refused pause, such as during a protected operation, is reported, not thrown.
    f.workspaces.work = [agent('Claude Code')]
    f.setTabAgentPaused.mockImplementationOnce(() => { throw new Error('Agents are temporarily paused for a protected operation.') })
    expect(f.offers.takeOverFromPage('tab-a', 'work')).toBe(false)
    expect(f.onError).toHaveBeenCalledOnce()
  })

  it('hands a taken-over tab back when the request for you on it is resolved, and leaves other tabs', () => {
    const f = fixture()
    f.offers.takeOverFromPage('tab-a', 'work')
    f.paused.add('tab-b')
    f.offers.resolvedOn('tab-b')
    f.offers.resolvedOn(undefined)
    expect(f.setTabAgentPaused).toHaveBeenCalledOnce()
    f.offers.resolvedOn('tab-a')
    expect(f.setTabAgentPaused).toHaveBeenLastCalledWith('tab-a', false)
    expect(f.takenOver.has('tab-a')).toBe(false)
    expect(f.paused.has('tab-b')).toBe(true)
  })

  it('accepts only a boolean take-over option from the shell', () => {
    expect(tabAgentPauseOptions(undefined)).toEqual({ takeOver: false })
    expect(tabAgentPauseOptions({})).toEqual({ takeOver: false })
    expect(tabAgentPauseOptions({ takeOver: true })).toEqual({ takeOver: true })
    for (const value of [null, [], 'yes', { takeOver: 'yes' }, { takeOver: true, extra: 1 }]) {
      expect(() => tabAgentPauseOptions(value)).toThrow('Invalid tab agent pause options')
    }
  })
})
