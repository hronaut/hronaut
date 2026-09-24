import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('does not dispatch a queued freeze against a newer document', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  let pending: Promise<CallToolResult> | undefined
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    const target = page.debugger
    const original = target.sendCommand
    let intercept = true
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const state = {
      held: false, frozenCommands: 0, release,
      navigate: () => page.loadURL(`${url}?new-document=1`),
      restore: async () => {
        target.sendCommand = original
        await target.sendCommand('Page.setWebLifecycleState', { state: 'active' })
      }
    }
    ;(globalThis as typeof globalThis & { __hronautLifecycleGate?: typeof state }).__hronautLifecycleGate = state
    target.sendCommand = async function (...args) {
      if (intercept && args[0] === 'Emulation.setEmulatedMedia') {
        intercept = false
        state.held = true
        await gate
      }
      if (args[0] === 'Page.setWebLifecycleState' && args[1]?.state === 'frozen') state.frozenCommands += 1
      return original.apply(this, args)
    }
  }, fixtureUrl)
  try {
    pending = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautLifecycleGate?: { held: boolean } }).__hronautLifecycleGate?.held
    ))).toBe(true)
    await appWindow.evaluate(`(async () => {
      window.__hronautPendingFreeze = window.hronaut.setTabPageLifecycle(${JSON.stringify(tabId)}, 'frozen')
        .then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
      await window.hronaut.getState();
    })()`)
    await electronApp.evaluate(async () => {
      const state = (globalThis as typeof globalThis & { __hronautLifecycleGate?: { navigate: () => Promise<void>; release: () => void } }).__hronautLifecycleGate!
      await state.navigate()
      state.release()
    })
    const emulation = await pending
    expect(emulation.isError, text(emulation)).not.toBe(true)
    const result = await appWindow.evaluate('window.__hronautPendingFreeze')
    expect(await electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautLifecycleGate?: { frozenCommands: number } }).__hronautLifecycleGate?.frozenCommands
    ))).toBe(0)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('document changed') })
  } finally {
    await electronApp.evaluate(async () => {
      const state = (globalThis as typeof globalThis & { __hronautLifecycleGate?: { release: () => void; restore: () => Promise<void> } }).__hronautLifecycleGate
      state?.release()
      await state?.restore()
      delete (globalThis as typeof globalThis & { __hronautLifecycleGate?: unknown }).__hronautLifecycleGate
    }).catch(() => undefined)
    await pending?.catch(() => undefined)
    await appWindow.evaluate('(async () => { await window.__hronautPendingFreeze; delete window.__hronautPendingFreeze })()').catch(() => undefined)
  }
})
