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
      cancelForWorkspace: vi.fn(() => cancellation)
    }
    const callbacks = createWalletLifecycleCallbacks(() => broker)

    expect(invoke(callbacks)).toBe(cancellation)
  })
})
