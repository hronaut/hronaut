import { createServer } from 'node:http'
import type { BrowserReproRecording, HronautApi } from '../../src/shared/types.js'
import { reproCheckpointScript } from '../../src/main/browser/repro-checkpoint-script.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('times out a held checkpoint response without blocking Stop or recording a late expectation', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Checkpoint timeout fixture</title><p>Ready</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server')
    const url = `http://127.0.0.1:${address.port}/`
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
    const report = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    const checkpoint = { context: report.checkpointContext!, selector: 'p', condition: 'visible' as const, reviewed: true as const }
    // Fault-inject delivery of one real page evaluation result, not an OS freeze.
    await electronApp.evaluate(({ webContents }, input) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === input.url)!
      const original = page.executeJavaScript
      const state = globalThis as typeof globalThis & { __checkpointHeld?: boolean; __checkpointRelease?: () => void; __checkpointRestore?: () => void }
      state.__checkpointRestore = () => { page.executeJavaScript = original }
      page.executeJavaScript = async function (...args) {
        const result = await original.apply(this, args)
        if (args[0] !== input.script) return result
        page.executeJavaScript = original
        await new Promise<void>(resolve => { state.__checkpointRelease = resolve; state.__checkpointHeld = true })
        return result
      }
    }, { url, script: reproCheckpointScript(checkpoint) })
    await appWindow.evaluate(({ tabId, checkpoint }) => {
      const state = globalThis as typeof globalThis & { __checkpointOutcome?: { ok: boolean; error?: string } }
      void (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint).then(
        () => { state.__checkpointOutcome = { ok: true } },
        error => { state.__checkpointOutcome = { ok: false, error: String(error) } }
      )
    }, { tabId, checkpoint })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __checkpointHeld?: boolean }).__checkpointHeld)).toBe(true)
    await appWindow.evaluate(tabId => {
      const state = globalThis as typeof globalThis & { __checkpointStop?: Promise<BrowserReproRecording> }
      state.__checkpointStop = (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId)
    }, tabId)
    await expect.poll(() => appWindow.evaluate(() => (globalThis as typeof globalThis & { __checkpointOutcome?: { error?: string } }).__checkpointOutcome?.error), { timeout: 10_000 }).toContain('Checkpoint page read timed out')
    const stopped = await appWindow.evaluate(() => (globalThis as typeof globalThis & { __checkpointStop?: Promise<BrowserReproRecording> }).__checkpointStop!)
    expect(stopped).toMatchObject({ active: false, stepCount: 1 })
    await electronApp.evaluate(() => { (globalThis as typeof globalThis & { __checkpointRelease?: () => void }).__checkpointRelease?.() })
    expect(await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)).toEqual(stopped)
    const restarted = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    const retried = await appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint), { tabId, checkpoint: { ...checkpoint, context: restarted.checkpointContext! } })
    expect(retried.steps.filter(step => step.kind === 'expect')).toHaveLength(1)
    expect(retried.steps.at(-1)?.expectation).toMatchObject({ condition: 'visible', observedMatch: true })
  } finally {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & { __checkpointHeld?: boolean; __checkpointRelease?: () => void; __checkpointRestore?: () => void }
      state.__checkpointRelease?.(); state.__checkpointRestore?.()
      delete state.__checkpointHeld; delete state.__checkpointRelease; delete state.__checkpointRestore
    })
    await appWindow.evaluate(() => {
      const state = globalThis as typeof globalThis & { __checkpointOutcome?: unknown; __checkpointStop?: unknown }
      delete state.__checkpointOutcome; delete state.__checkpointStop
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
