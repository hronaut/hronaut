import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'

type Gate = { reads: number; cleanups: number; finishedCleanups: number; releaseReads(): void; releaseCleanup(): void; restore(): void }
type Scope = typeof globalThis & { __imageSlotGate?: Gate }
test('image inspection retains main slots through native timeout and unfinished cleanup', async ({ capabilities, electronApp }, info) => {
  const { client, tabId, fixtureUrl } = capabilities
  const pending: Array<Promise<CallToolResult>> = []
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    await page.executeJavaScript("document.body.innerHTML='<img id=target>';void 0")
    const original = page.executeJavaScriptInIsolatedWorld
    let releaseReads!: () => void, releaseCleanup!: () => void
    const reads = new Promise<void>(resolve => { releaseReads = resolve })
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve })
    const state: Gate = { reads: 0, cleanups: 0, finishedCleanups: 0, releaseReads, releaseCleanup, restore: () => { page.executeJavaScriptInIsolatedWorld = original } }
    ;(globalThis as Scope).__imageSlotGate = state
    page.executeJavaScriptInIsolatedWorld = async function (...args) {
      const code = args[1][0]!.code
      if (args[0] === 1022 && code.includes('const selector=')) {
        state.reads++
        const value = await original.apply(this, args)
        await reads
        return value
      }
      if (args[0] === 1022 && code.includes('handle?.cleanup()')) {
        state.cleanups++
        await cleanup
        const value = await original.apply(this, args)
        state.finishedCleanups++
        return value
      }
      return original.apply(this, args)
    }
  }, fixtureUrl)
  const inspect = () => client.callTool({ name: 'browser_image_state', arguments: { tabId, selector: '#target' } }) as Promise<CallToolResult>
  try {
    for (let i = 0; i < 8; i++) pending.push(inspect())
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.reads)).toBe(8)
    expect(text(await inspect())).toContain('inspection busy')
    const results = await Promise.all(pending)
    expect(results.every(result => result.isError && text(result).includes('expired'))).toBe(true)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.cleanups)).toBe(8)
    expect(text(await inspect())).toContain('inspection busy')
    await electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.releaseReads())
    expect(text(await inspect())).toContain('inspection busy')
    await electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.releaseCleanup())
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.finishedCleanups)).toBe(8)
    const receipt = await electronApp.evaluate(() => { const s = (globalThis as Scope).__imageSlotGate!; return { reads: s.reads, cleanups: s.cleanups, finishedCleanups: s.finishedCleanups } })
    await info.attach('native-slot-lifetime', { body: JSON.stringify(receipt), contentType: 'application/json' })
    expect(receipt).toEqual({ reads: 8, cleanups: 8, finishedCleanups: 8 })
    await electronApp.evaluate(() => (globalThis as Scope).__imageSlotGate!.restore())
    const recovered = await inspect()
    expect(recovered.isError, text(recovered)).not.toBe(true)
  } finally {
    await electronApp.evaluate(() => { const s = (globalThis as Scope).__imageSlotGate; s?.releaseReads(); s?.releaseCleanup(); s?.restore(); delete (globalThis as Scope).__imageSlotGate })
    await Promise.allSettled(pending)
  }
})
