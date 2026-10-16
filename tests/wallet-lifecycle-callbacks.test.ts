import { describe, expect, it, vi } from 'vitest'
import {
  createWalletLifecycleCallbacks,
  type WalletLifecycleBroker
} from '../src/main/wallet/lifecycle-callbacks.js'

describe('createWalletLifecycleCallbacks', () => {
  it.each([
    ['navigation', (callbacks: ReturnType<typeof createWalletLifecycleCallbacks>) => callbacks.onWalletNavigation('tab-a', 2)],
    ['tab closure', (callbacks: ReturnType<typeof createWalletLifecycleCallbacks>) => callbacks.onWalletTabClosed('tab-a')],
    ['workspace closure', (callbacks: ReturnType<typeof createWalletLifecycleCallbacks>) => callbacks.onWalletWorkspaceClosed('workspace-a')]
  ])('forwards asynchronous %s cancellation failures to the lifecycle boundary', async (_name, invoke) => {
    const failure = new Error('approval persistence failed')
    const cancellation = Promise.reject(failure)
    void cancellation.catch(() => undefined)
    const broker: WalletLifecycleBroker = {
      cancelForNavigation: vi.fn(() => cancellation),
      cancelForTab: vi.fn(() => cancellation),
      resumeTab: vi.fn(() => Promise.resolve()),
      cancelForWorkspace: vi.fn(() => cancellation),
      keepsTabAwake: vi.fn(() => false)
    }
    const callbacks = createWalletLifecycleCallbacks(() => broker)

    expect(invoke(callbacks)).toBe(cancellation)
  })

  it('keeps a tab awake only while the wallet broker says its page still waits on it', () => {
    const keepsTabAwake = vi.fn((tabId: string) => tabId === 'tab-a')
    const broker: WalletLifecycleBroker = {
      cancelForNavigation: vi.fn(() => Promise.resolve()),
      cancelForTab: vi.fn(() => Promise.resolve()),
      resumeTab: vi.fn(() => Promise.resolve()),
      cancelForWorkspace: vi.fn(() => Promise.resolve()),
      keepsTabAwake
    }

    expect(createWalletLifecycleCallbacks(() => broker).walletKeepsTabAwake('tab-a')).toBe(true)
    expect(createWalletLifecycleCallbacks(() => broker).walletKeepsTabAwake('tab-b')).toBe(false)
    // Before the wallet broker starts, no page can be waiting on it.
    expect(createWalletLifecycleCallbacks(() => null).walletKeepsTabAwake('tab-a')).toBe(false)
  })
})
