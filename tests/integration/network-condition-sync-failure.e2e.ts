import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type SyncFailureGate = { waiting: boolean; release(): void; restore(): void }
type SyncFailureScope = typeof globalThis & { __conditionSyncFailure?: SyncFailureGate }

for (const action of ['add', 'add with newer draft', 'remove'] as const) {
  test(`Network condition ${action} remains committed after browser state refresh fails`, async ({ capabilities, electronApp, appWindow }) => {
    const { tabId, fixtureUrl, fixtureOrigin, openPageTool } = capabilities
    const pattern = `${fixtureOrigin}/route-target`
    if (action === 'remove') {
      await appWindow.evaluate(({ tabId, pattern }) => (window as unknown as { hronaut: HronautApi }).hronaut.addNetworkRoute(tabId, {
        urlPattern: pattern, times: 2, response: { status: 409, body: 'committed condition' }
      }), { tabId, pattern })
    }
    await openPageTool(/Request conditions/)
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const form = panel.getByRole('form', { name: 'Add temporary request condition' })
    await form.getByLabel('URL pattern').fill(pattern)
    await form.getByLabel('Behavior').selectOption('fulfill')
    await form.getByLabel('HTTP status').fill('409')
    await form.getByLabel('Matches', { exact: true }).fill('2')
    await form.getByLabel(/Response body/).fill('committed condition')
    await electronApp.evaluate(({ ipcMain }, action) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const mutationChannel = action === 'remove' ? 'browser:remove-network-route' : 'browser:add-network-route'
      const originals = [mutationChannel, 'browser:get-state'].map(channel => ({ channel, handler: handlers.get(channel)! }))
      let armed = false
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: SyncFailureGate = { waiting: false, release, restore: () => {
        release()
        for (const { channel, handler } of originals) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      } }
      ;(globalThis as SyncFailureScope).__conditionSyncFailure = gate
      for (const { channel, handler } of originals) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, ...args) => {
          const result = await handler(event, ...args)
          if (channel === mutationChannel) armed = true
          else if (armed) {
            armed = false
            gate.waiting = true
            await barrier
            throw new Error('Controlled post-commit browser state failure')
          }
          return result
        })
      }
    }, action)
    try {
      if (action === 'remove') await panel.getByRole('button', { name: `Remove request condition ${pattern}`, exact: true }).click()
      else await form.getByRole('button', { name: 'Add condition', exact: true }).click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as SyncFailureScope).__conditionSyncFailure?.waiting)).toBe(true)
      const routes = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(id), tabId)
      expect(routes).toHaveLength(action === 'remove' ? 0 : 1)
      if (action === 'add with newer draft') {
        await form.getByLabel('URL pattern').fill(`${fixtureOrigin}/newer-draft`)
        await form.getByLabel(/Response body/).fill('newer body')
      }
      await electronApp.evaluate(() => (globalThis as SyncFailureScope).__conditionSyncFailure!.release())
      await expect(panel.getByRole('alert')).toContainText('The condition change was saved, but browser state could not be refreshed.')
      await expect(panel.locator('.request-condition-item')).toHaveCount(action === 'remove' ? 0 : 1)
      await expect(form.getByLabel('URL pattern')).toHaveValue(action === 'add' ? '' : action === 'remove' ? pattern : `${fixtureOrigin}/newer-draft`)
      await expect(form.getByLabel(/Response body/)).toHaveValue(action === 'add' ? '' : action === 'remove' ? 'committed condition' : 'newer body')
      if (action !== 'remove') {
        const response = await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          return page.executeJavaScript("fetch('/route-target').then(async response => ({status:response.status,body:await response.text()}))")
        }, fixtureUrl)
        expect(response).toEqual({ status: 409, body: 'committed condition' })
      }
    } finally {
      await electronApp.evaluate(() => { (globalThis as SyncFailureScope).__conditionSyncFailure?.restore(); delete (globalThis as SyncFailureScope).__conditionSyncFailure }).catch(() => undefined)
    }
  })
}
