import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './capability-fixtures.js'

type DraftGate = { ready: boolean; release(): void; restore(): void }
type DraftGlobal = typeof globalThis & { __conditionDraftGate?: DraftGate }

for (const outcome of ['edited success', 'unchanged success', 'edited failure'] as const) {
  test(`Network condition form preserves draft ownership across ${outcome}`, async ({ capabilities, electronApp, appWindow }) => {
    const { tabId, fixtureUrl, fixtureOrigin, openPageTool } = capabilities
    await openPageTool(/Request conditions/)
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const form = panel.getByRole('form', { name: 'Add temporary request condition' })
    const pattern = form.getByLabel('URL pattern')
    const body = form.getByLabel(/Response body/)
    await pattern.fill(`${fixtureOrigin}/route-target`)
    await form.getByLabel('Behavior').selectOption('fulfill')
    await form.getByLabel('HTTP status').fill('409')
    await body.fill('submitted mock body')
    await electronApp.evaluate(({ webContents }, { url, fail }) => {
      const api = webContents.getAllWebContents().find(page => page.getURL() === url)!.debugger
      const send = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: DraftGate = { ready: false, release, restore: () => { api.sendCommand = send } }
      ;(globalThis as DraftGlobal).__conditionDraftGate = gate
      api.sendCommand = async (method, ...args) => {
        if (method === 'Fetch.enable' && !gate.ready) {
          gate.ready = true
          await barrier
          if (fail) throw new Error('Controlled condition application failure')
        }
        return send.call(api, method, ...args)
      }
    }, { url: fixtureUrl, fail: outcome === 'edited failure' })
    try {
      await form.getByRole('button', { name: 'Add condition', exact: true }).click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as DraftGlobal).__conditionDraftGate?.ready)).toBe(true)
      if (outcome !== 'unchanged success') {
        await pattern.fill(`${fixtureOrigin}/next-condition`)
        await body.fill('next unsent mock body')
        await form.getByLabel('HTTP status').fill('418')
      }
      await electronApp.evaluate(() => (globalThis as DraftGlobal).__conditionDraftGate!.release())
      await expect(form.getByRole('button', { name: 'Add condition', exact: true })).toBeVisible()
      await expect(pattern).toHaveValue(outcome === 'unchanged success' ? '' : `${fixtureOrigin}/next-condition`)
      await expect(body).toHaveValue(outcome === 'unchanged success' ? '' : 'next unsent mock body')
      await expect(form.getByLabel('HTTP status')).toHaveValue(outcome === 'unchanged success' ? '200' : '418')
      const routes = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRoutes(id), tabId)
      expect(routes).toHaveLength(outcome === 'edited failure' ? 0 : 1)
      if (outcome === 'edited failure') {
        await expect(panel.getByRole('alert')).toContainText('Controlled condition application failure')
      } else {
        expect(routes[0]).toMatchObject({ urlPattern: `${fixtureOrigin}/route-target`, response: { status: 409 } })
        const response = await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          return page.executeJavaScript("fetch('/route-target').then(async response => ({status:response.status,body:await response.text()}))")
        }, fixtureUrl)
        expect(response).toEqual({ status: 409, body: 'submitted mock body' })
      }
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as DraftGlobal
        scope.__conditionDraftGate?.release()
        scope.__conditionDraftGate?.restore()
        delete scope.__conditionDraftGate
      }).catch(() => undefined)
    }
  })
}
