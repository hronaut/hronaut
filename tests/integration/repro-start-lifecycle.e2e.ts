import { createServer } from 'node:http'
import type { BrowserReproRecording, BrowserState } from '../../src/shared/types.js'
import { reproScrollScript } from '../../src/main/browser/repro-page-scripts.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const action of ['clear', 'stop', 'restart', 'navigate', 'close'] as const) {
  test(`does not resurrect a pending reproduction recording after ${action}`, async ({ appWindow, electronApp }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Repro start lifecycle</title><main>Fixture</main>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    let pending: Promise<{ ok: boolean; error?: string }> | undefined
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Fixture port is unavailable')
      const url = `http://127.0.0.1:${address.port}/`
      const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
        webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading())
      ), url)).toBe(true)
      await electronApp.evaluate(({ webContents }, input) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === input.url)!
        const original = page.executeJavaScript
        const testState = globalThis as typeof globalThis & {
          __reproStartHeld?: boolean
          __reproStartRelease?: () => void
          __reproStartRestore?: () => void
        }
        testState.__reproStartRestore = () => { page.executeJavaScript = original }
        page.executeJavaScript = async function (...args) {
          const result = await original.apply(this, args)
          if (args[0] !== input.script) return result
          page.executeJavaScript = original
          await new Promise<void>(resolve => {
            testState.__reproStartRelease = resolve
            testState.__reproStartHeld = true
          })
          return result
        }
      }, { url, script: reproScrollScript() })
      pending = appWindow.evaluate(`window.hronaut.manageRepro('start', ${JSON.stringify(tabId)}).then(
        () => ({ ok: true }), error => ({ ok: false, error: String(error) })
      )`)
      await expect.poll(() => electronApp.evaluate(() => (
        (globalThis as typeof globalThis & { __reproStartHeld?: boolean }).__reproStartHeld === true
      ))).toBe(true)

      let replacement: BrowserReproRecording | undefined
      if (action === 'navigate') {
        await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.loadURL(`${url}after`)
        }, url)
      } else if (action === 'close') {
        await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
      } else {
        replacement = await appWindow.evaluate(`window.hronaut.manageRepro(${JSON.stringify(action === 'restart' ? 'start' : action)}, ${JSON.stringify(tabId)})`)
      }
      await electronApp.evaluate(() => {
        ;(globalThis as typeof globalThis & { __reproStartRelease?: () => void }).__reproStartRelease?.()
      })
      const result = await pending
      expect(result.ok).toBe(false)
      expect(result.error).toContain('changed while starting')
      if (action === 'close') {
        const current = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
        expect(current.tabs.some(tab => tab.id === tabId)).toBe(false)
      } else {
        const current = await appWindow.evaluate(`window.hronaut.manageRepro('get', ${JSON.stringify(tabId)})`) as BrowserReproRecording
        if (action === 'restart') expect(current).toEqual(replacement)
        else expect(current).toMatchObject({ active: false, stepCount: 0 })
      }
    } finally {
      await electronApp.evaluate(() => {
        const testState = globalThis as typeof globalThis & {
          __reproStartHeld?: boolean
          __reproStartRelease?: () => void
          __reproStartRestore?: () => void
        }
        testState.__reproStartRelease?.()
        testState.__reproStartRestore?.()
        delete testState.__reproStartHeld
        delete testState.__reproStartRelease
        delete testState.__reproStartRestore
      })
      await pending?.catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
