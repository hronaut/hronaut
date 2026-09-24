import { createServer } from 'node:http'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const change of ['navigation', 'same-url navigation', 'close'] as const) {
  test(`rejects a DOM recording result captured before ${change}`, async ({ appWindow, electronApp }) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><title>DOM lifecycle ${request.url}</title><main>Fixture</main>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server')
      const origin = `http://127.0.0.1:${address.port}`
      const before = `${origin}/before`
      const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(before)}, active: true })`) as BrowserState
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), before)).toBe(true)
      await electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const original = page.executeJavaScriptInIsolatedWorld
        const held = globalThis as typeof globalThis & {
          __domLifecycleHeld?: boolean
          __domLifecycleRelease?: () => void
          __domLifecycleRestore?: () => void
        }
        held.__domLifecycleRestore = () => { page.executeJavaScriptInIsolatedWorld = original }
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          const result = await original.apply(this, args)
          if (args[0] !== 1005) return result
          page.executeJavaScriptInIsolatedWorld = original
          await new Promise<void>(resolve => {
            held.__domLifecycleRelease = resolve
            held.__domLifecycleHeld = true
          })
          return result
        }
      }, before)
      await appWindow.evaluate(`globalThis.__domLifecyclePending = window.hronaut.manageDomChanges('start', ${JSON.stringify(tabId)}).then(
        value => ({ ok: true, value }), error => ({ ok: false, error: String(error) })
      ); undefined`)
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __domLifecycleHeld?: boolean }).__domLifecycleHeld === true)).toBe(true)
      if (change === 'close') {
        await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
      } else {
        await electronApp.evaluate(async ({ webContents }, input) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === input.before)!
          await page.loadURL(input.after)
        }, { before, after: change === 'navigation' ? `${origin}/after` : before })
      }
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __domLifecycleRelease?: () => void }).__domLifecycleRelease?.())
      const result = await appWindow.evaluate('globalThis.__domLifecyclePending') as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      expect(result.error).toContain('changed while reading DOM changes')
      if (change !== 'close') {
        const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
        expect(state.tabs.find(tab => tab.id === tabId)?.domChangesRecording).toBeUndefined()
        expect(await appWindow.evaluate(`window.hronaut.manageDomChanges('start', ${JSON.stringify(tabId)})`)).toMatchObject({ active: true, changeCount: 0 })
      }
    } finally {
      await electronApp.evaluate(() => {
        const held = globalThis as typeof globalThis & {
          __domLifecycleHeld?: boolean
          __domLifecycleRelease?: () => void
          __domLifecycleRestore?: () => void
        }
        held.__domLifecycleRelease?.()
        held.__domLifecycleRestore?.()
        delete held.__domLifecycleHeld
        delete held.__domLifecycleRelease
        delete held.__domLifecycleRestore
      }).catch(() => undefined)
      await appWindow.evaluate('delete globalThis.__domLifecyclePending').catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
