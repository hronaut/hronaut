import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'

// A page whose renderer exited while it loaded ended browser_navigate with Electron's bare "ERR_FAILED (-2) loading",
// as a network failure would, and showed the person that error on top of the tab's notice that the page stopped working.

/**
 * A tab whose load fails as Electron fails it, with its renderer gone or still running. As in Electron, the failure
 * comes before the renderer is marked gone.
 */
function navigationThatFails(rendererExited: boolean) {
  let crashed = false
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => crashed,
    loadURL: vi.fn(async () => {
      if (rendererExited) setImmediate(() => { crashed = true })
      throw Object.assign(new Error("ERR_FAILED (-2) loading 'https://next.example/'"), { code: 'ERR_FAILED', errno: -2 })
    })
  })
  const tab = { id: 'tab', navigationGeneration: 0, documentGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: false, webContents }
  const access = {
    getTab: () => tab,
    findTab: (id: string) => (id === tab.id ? tab : undefined),
    searchEngine: () => undefined,
    prepareDiagnosticNavigation: vi.fn(),
    confirmLeavePage: vi.fn(),
    getState: () => ({ ok: true })
  }
  return (byPerson: boolean) => navigate(access as never, 'https://next.example/', undefined, { byPerson })
}

describe('a load that ends because the page renderer exited', () => {
  it('tells an agent the renderer exited, not that the network failed', async () => {
    const navigation = navigationThatFails(true)(false)
    await expect(navigation).rejects.toBeInstanceOf(RendererExitedError)
    await expect(navigation).rejects.toMatchObject({ message: expect.stringContaining('renderer exited'), sent: true })
  })

  it('leaves the person with the tab notice that the page stopped working', async () => {
    await expect(navigationThatFails(true)(true)).resolves.toEqual({ ok: true })
  })

  it.each([false, true])('still fails a load whose renderer kept running (by a person: %s)', async byPerson => {
    await expect(navigationThatFails(false)(byPerson)).rejects.toThrow('ERR_FAILED (-2)')
  })
})
