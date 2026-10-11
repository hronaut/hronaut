import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type CopyCloseGate = { waiting: boolean; settled: boolean; calls: number; release(): void; restore(): void }
type CopyCloseScope = typeof globalThis & { __diagnosticCopyClose?: CopyCloseGate }
const cases = [
  { kind: 'debug', fail: true },
  ...['timeline', 'playwright'].flatMap(kind => [false, true].map(fail => ({ kind, fail })))
]

for (const { kind, fail } of cases) {
  test(`Diagnostic close retires ${kind} clipboard ${fail ? 'failure' : 'success'}`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, openPageTool } = capabilities
    const repro = kind !== 'debug'
    const getRecording = () => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
    if (repro) {
      await appWindow.evaluate(async tabId => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const started = await api.manageRepro('start', tabId)
        await api.manageRepro('checkpoint', tabId, { context: started.checkpointContext!, condition: 'urlPath', path: '/complete', reviewed: true })
        await api.manageRepro('stop', tabId)
      }, tabId)
    }
    const recording = repro ? await getRecording() : undefined
    const open = () => openPageTool(repro ? /Repro recorder:/ : /^(Create debug report$|Debug report:)/)
    await open()
    const panel = appWindow.getByRole('dialog', { name: repro ? 'Repro recorder' : 'Debug report', exact: true })
    const label = kind === 'debug' ? 'Copy report' : kind === 'timeline' ? 'Copy timeline' : 'Copy Playwright'
    const success = kind === 'playwright' ? 'Copied Playwright' : 'Copied'
    const copy = panel.getByRole('button', { name: new RegExp(`^(${label}|${success})$`) })
    await expect(copy).toBeEnabled()
    await electronApp.evaluate(({ ipcMain }, fail) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing diagnostic clipboard handler')
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: CopyCloseGate = { waiting: false, settled: false, calls: 0, release, restore: () => {
        release()
        ipcMain.removeHandler('browser:copy-text')
        ipcMain.handle('browser:copy-text', original)
      } }
      ;(globalThis as CopyCloseScope).__diagnosticCopyClose = gate
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', async (event, ...args) => {
        gate.calls++
        const result = await original(event, ...args)
        if (gate.calls === 1) {
          gate.waiting = true
          await barrier
          gate.settled = true
          if (fail) throw new Error('Closed diagnostic clipboard reply failure')
        }
        return result
      })
    }, fail)
    try {
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CopyCloseScope).__diagnosticCopyClose!.waiting)).toBe(true)
      const written = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      if (kind === 'playwright') expect(written).toContain('reproduce:')
      else expect(JSON.parse(written)).toMatchObject({ tabId })
      await panel.locator('.panel-close').click()
      await expect(panel).toBeHidden()
      if (repro) { await open(); await expect(copy).toBeEnabled() }
      await electronApp.evaluate(() => (globalThis as CopyCloseScope).__diagnosticCopyClose!.release())
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CopyCloseScope).__diagnosticCopyClose!.settled)).toBe(true)
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Closed diagnostic clipboard reply failure' }).count()).toBe(0)
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(written)
      if (!repro) await open()
      expect((await copy.innerText()).trim()).toBe(label)
      if (repro) expect(await getRecording()).toEqual(recording)
      await copy.click()
      await expect(copy).toHaveText(success)
    } finally {
      await electronApp.evaluate(() => {
        (globalThis as CopyCloseScope).__diagnosticCopyClose?.restore()
        delete (globalThis as CopyCloseScope).__diagnosticCopyClose
      }).catch(() => undefined)
    }
  })
}
