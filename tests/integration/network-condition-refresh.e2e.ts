import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type ConditionRefreshGate = { waiting: boolean; release(): void; restore(): void }
type ConditionRefreshScope = typeof globalThis & { __conditionRefresh?: ConditionRefreshGate }

test('Network condition refresh reconciles a rule consumed during state synchronization', async ({ capabilities, electronApp, appWindow }) => {
  const { tabId, fixtureUrl, fixtureOrigin, openPageTool } = capabilities
  await openPageTool(/Request conditions/)
  const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
  const form = panel.getByRole('form', { name: 'Add temporary request condition' })
  await form.getByLabel('URL pattern').fill(`${fixtureOrigin}/route-target`)
  await form.getByLabel('Behavior').selectOption('fulfill')
  await form.getByLabel('HTTP status').fill('409')
  await form.getByLabel(/Response body/).fill('one-shot body')
  await electronApp.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const originals = ['browser:add-network-route', 'browser:get-state'].map(channel => ({ channel, handler: handlers.get(channel)! }))
    let armed = false
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const gate: ConditionRefreshGate = { waiting: false, release, restore: () => {
      release()
      for (const { channel, handler } of originals) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
    } }
    ;(globalThis as ConditionRefreshScope).__conditionRefresh = gate
    for (const { channel, handler } of originals) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        const result = await handler(event, ...args)
        if (channel === 'browser:add-network-route') armed = true
        else if (armed) { armed = false; gate.waiting = true; await barrier }
        return result
      })
    }
  })
  try {
    await form.getByRole('button', { name: 'Add condition', exact: true }).click()
    await expect.poll(() => electronApp.evaluate(() => (globalThis as ConditionRefreshScope).__conditionRefresh?.waiting)).toBe(true)
    await expect(appWindow.getByRole('button', { name: 'Open 1 temporary request condition', exact: true })).toBeVisible()
    const response = await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      return page.executeJavaScript("fetch('/route-target').then(async response => ({status:response.status,body:await response.text()}))")
    }, fixtureUrl)
    expect(response).toEqual({ status: 409, body: 'one-shot body' })
    await expect(appWindow.getByRole('button', { name: 'Open 1 temporary request condition', exact: true })).toHaveCount(0)
    expect(await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(id), tabId)).toEqual([])
    await form.getByLabel('URL pattern').fill(`${fixtureOrigin}/newer-draft`)
    await electronApp.evaluate(() => (globalThis as ConditionRefreshScope).__conditionRefresh!.release())
    await expect(form.getByRole('button', { name: 'Add condition', exact: true })).toBeVisible()
    await expect(panel.locator('.request-condition-item')).toHaveCount(0)
    await expect(form.getByLabel('URL pattern')).toHaveValue(`${fixtureOrigin}/newer-draft`)
  } finally {
    await electronApp.evaluate(() => { (globalThis as ConditionRefreshScope).__conditionRefresh?.restore(); delete (globalThis as ConditionRefreshScope).__conditionRefresh }).catch(() => undefined)
  }
})

for (const fail of [false, true]) {
  test(`Network condition refresh cannot publish an uncommitted ${fail ? 'failed' : 'successful'} add`, async ({ capabilities, electronApp, appWindow }) => {
    const { tabId, fixtureUrl, fixtureOrigin, openPageTool } = capabilities
    await openPageTool(/Request conditions/)
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const form = panel.getByRole('form', { name: 'Add temporary request condition' })
    const pattern = `${fixtureOrigin}/route-target`
    await form.getByLabel('URL pattern').fill(pattern)
    await form.getByLabel('Behavior').selectOption('fulfill')
    await form.getByLabel('HTTP status').fill('409')
    await form.getByLabel(/Response body/).fill('committed condition body')
    await electronApp.evaluate(({ webContents }, { url, fail }) => {
      const api = webContents.getAllWebContents().find(page => page.getURL() === url)!.debugger
      const send = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: ConditionRefreshGate = { waiting: false, release, restore: () => { release(); api.sendCommand = send } }
      ;(globalThis as ConditionRefreshScope).__conditionRefresh = gate
      api.sendCommand = async (method, ...args) => {
        if (method === 'Fetch.enable' && !gate.waiting) {
          gate.waiting = true
          await barrier
          if (fail) throw new Error('Controlled condition refresh application failure')
        }
        return send.call(api, method, ...args)
      }
    }, { url: fixtureUrl, fail })
    try {
      await form.getByRole('button', { name: 'Add condition', exact: true }).click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ConditionRefreshScope).__conditionRefresh?.waiting)).toBe(true)
      // A separate trusted-shell action broadcasts state while Chromium still
      // holds the proposed rule. The changed count triggers the panel's refresh.
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabMuted(id, true), tabId)
      await expect(appWindow.getByRole('button', { name: 'Unmute Tab', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      await expect(form.getByRole('button', { name: /Adding/ })).toBeDisabled()
      await expect(panel.locator('.request-condition-item')).toHaveCount(0)
      await electronApp.evaluate(() => (globalThis as ConditionRefreshScope).__conditionRefresh!.release())
      await expect(form.getByRole('button', { name: 'Add condition', exact: true })).toBeVisible()
      const routes = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(id), tabId)
      expect(routes).toHaveLength(fail ? 0 : 1)
      await expect(panel.locator('.request-condition-item')).toHaveCount(fail ? 0 : 1)
      if (fail) {
        await expect(panel.getByRole('alert')).toContainText('Controlled condition refresh application failure')
        await expect(form.getByLabel('URL pattern')).toHaveValue(pattern)
      } else {
        const response = await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          return page.executeJavaScript("fetch('/route-target').then(async response => ({status:response.status,body:await response.text()}))")
        }, fixtureUrl)
        expect(response).toEqual({ status: 409, body: 'committed condition body' })
      }
    } finally {
      await electronApp.evaluate(() => { (globalThis as ConditionRefreshScope).__conditionRefresh?.restore(); delete (globalThis as ConditionRefreshScope).__conditionRefresh }).catch(() => undefined)
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabMuted(id, false), tabId).catch(() => undefined)
    }
  })
}
