import { createServer } from 'node:http'
import type { BrowserReproRecording, BrowserState } from '../../src/shared/types.js'
import { reproScrollScript, reproTargetScript } from '../../src/main/browser/page-scripts.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const cases = [
  { phase: 'queued input', action: 'restart' },
  { phase: 'queued input', action: 'clear' },
  { phase: 'queued input', action: 'close' },
  { phase: 'scroll flush', action: 'restart' },
  { phase: 'scroll flush', action: 'clear' },
  { phase: 'scroll flush', action: 'close' },
  { phase: 'concurrent stops', action: 'restart' },
  { phase: 'in-flight scroll', action: 'restart' }
] as const

for (const { phase, action } of cases) {
  test(phase === 'in-flight scroll' ? 'waits for an already running scroll capture before stopping' : phase === 'concurrent stops' ? 'shares the final scroll flush between concurrent recorder stops' : `rejects a recorder stop waiting for ${phase} after ${action}`, async ({ appWindow, electronApp }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Repro stop lifecycle</title><main tabindex="0" style="height:4000px">Scrollable fixture</main>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server')
      const url = `http://127.0.0.1:${address.port}/`
      const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
      await appWindow.evaluate(`window.hronaut.manageRepro('start', ${JSON.stringify(tabId)})`)
      await electronApp.evaluate(async ({ webContents }, input) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === input.url)!
        if (input.concurrent) await page.executeJavaScript('window.scrollTo(0, 300)')
        const original = page.executeJavaScript
        const testState = globalThis as typeof globalThis & {
          __reproStopHeld?: boolean
          __reproStopRelease?: () => void
          __reproStopRestore?: () => void
        }
        testState.__reproStopRestore = () => { page.executeJavaScript = original }
        page.executeJavaScript = async function (...args) {
          const result = await original.apply(this, args)
          if (args[0] !== input.script) return result
          page.executeJavaScript = original
          await new Promise<void>(resolve => {
            testState.__reproStopRelease = resolve
            testState.__reproStopHeld = true
          })
          return result
        }
        // Control whether the debounce fires before Stop or is flushed by it.
        // The shim exists only during this synchronous native input dispatch.
        const nativeSetTimeout = globalThis.setTimeout
        globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
          nativeSetTimeout(handler, delay === 250 ? (input.inFlight ? 0 : 60_000) : delay, ...args)
        ) as typeof setTimeout
        try {
          if (input.queuedInput) {
            page.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'ArrowDown' })
          } else {
            page.emit('before-mouse-event', { preventDefault() {} }, { type: 'mouseWheel', x: 10, y: 10 })
          }
        } finally {
          globalThis.setTimeout = nativeSetTimeout
        }
      }, { url, inFlight: phase === 'in-flight scroll', concurrent: phase === 'concurrent stops' || phase === 'in-flight scroll', queuedInput: phase === 'queued input', script: phase === 'queued input' ? reproTargetScript() : reproScrollScript() })
      if (phase === 'in-flight scroll') {
        await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __reproStopHeld?: boolean }).__reproStopHeld === true)).toBe(true)
      }
      // Send Stop before any replacement start on the same renderer IPC channel.
      await appWindow.evaluate(`globalThis.__reproPendingStop = window.hronaut.manageRepro('stop', ${JSON.stringify(tabId)}).then(
        () => ({ ok: true }), error => ({ ok: false, error: String(error) })
      ); undefined`)
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __reproStopHeld?: boolean }).__reproStopHeld === true)).toBe(true)
      if (phase === 'concurrent stops' || phase === 'in-flight scroll') {
        await appWindow.evaluate(`globalThis.__reproSecondStop = window.hronaut.manageRepro('stop', ${JSON.stringify(tabId)}); undefined`)
        await appWindow.evaluate(`window.hronaut.manageRepro('get', ${JSON.stringify(tabId)})`)
        await electronApp.evaluate(() => {
          ;(globalThis as typeof globalThis & { __reproStopRelease?: () => void }).__reproStopRelease?.()
        })
        const [first, second] = await appWindow.evaluate('Promise.all([globalThis.__reproPendingStop, globalThis.__reproSecondStop])') as [{ ok: boolean }, BrowserReproRecording]
        expect(first.ok).toBe(true)
        expect(second).toMatchObject({ active: false, stepCount: 2 })
        expect(second.steps[1]).toMatchObject({ kind: 'scroll', scroll: { x: 0, y: 300 } })
        expect(await appWindow.evaluate(`window.hronaut.manageRepro('get', ${JSON.stringify(tabId)})`)).toEqual(second)
        return
      }
      let replacement: BrowserReproRecording | undefined
      if (action === 'close') {
        await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
      } else {
        replacement = await appWindow.evaluate(`window.hronaut.manageRepro(${JSON.stringify(action === 'restart' ? 'start' : 'clear')}, ${JSON.stringify(tabId)})`)
        await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript('window.scrollTo(0, 300)')
        }, url)
      }
      await electronApp.evaluate(() => {
        ;(globalThis as typeof globalThis & { __reproStopRelease?: () => void }).__reproStopRelease?.()
      })
      const outcome = await appWindow.evaluate('globalThis.__reproPendingStop') as { ok: boolean; error?: string }
      if (action === 'close') {
        const current = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
        expect(current.tabs.some(tab => tab.id === tabId)).toBe(false)
      } else {
        const current = await appWindow.evaluate(`window.hronaut.manageRepro('get', ${JSON.stringify(tabId)})`) as BrowserReproRecording
        expect(current).toEqual(replacement)
      }
      expect(outcome.ok).toBe(false)
      expect(outcome.error).toContain('changed while stopping')

    } finally {
      await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __reproStopHeld?: boolean
          __reproStopRelease?: () => void
          __reproStopRestore?: () => void
        }
        state.__reproStopRelease?.()
        state.__reproStopRestore?.()
        delete state.__reproStopHeld
        delete state.__reproStopRelease
        delete state.__reproStopRestore
      })
      await appWindow.evaluate('Promise.allSettled([globalThis.__reproPendingStop, globalThis.__reproSecondStop]).finally(() => { delete globalThis.__reproPendingStop; delete globalThis.__reproSecondStop })').catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
