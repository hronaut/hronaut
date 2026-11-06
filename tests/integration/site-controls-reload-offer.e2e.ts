import { createServer } from 'node:http'
import type { HronautApi, HronautPermissionsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Blocking a website's location in Site controls left a page already watching it going on, with nothing saying the
// change applies once the page loads again. As Chrome's site information does, Site controls now offer to reload it.
test('Site controls offer to reload the page after a permission changed, until the page loads again', async ({ appWindow }) => {
  let loads = 0
  const server = createServer((request, response) => {
    if (request.url === '/') loads += 1
    response.writeHead(request.url === '/' || request.url === '/other' ? 200 : 404, { 'content-type': 'text/html' })
    response.end(request.url === '/' ? '<!doctype html><title>Reload offer</title><h1>Synthetic reload offer fixture</h1>' : '<title>Other</title>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const tabs = await appWindow.evaluate(async (site) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const created = await api.createWorkspace({ name: 'Reload offer', storage: 'scratch' })
      const workspaceId = created.mcpTabGroups.find(group => group.name === 'Reload offer')!.id
      await (window as unknown as { hronautPermissions: HronautPermissionsApi }).hronautPermissions.set(site, 'geolocation', 'allow', { workspaceId })
      const other = (await api.newTab({ url: `${site}/other`, mcpGroupId: workspaceId, active: true })).activeTabId!
      const page = (await api.newTab({ url: `${site}/`, mcpGroupId: workspaceId, active: true })).activeTabId!
      return { page, other }
    }, site)
    await expect.poll(() => loads).toBe(1)
    const selectTab = (tabId: string) => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId), tabId)

    const siteControls = appWindow.getByRole('button', { name: 'Site controls for 127.0.0.1', exact: true })
    await siteControls.click()
    const panel = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    const offer = panel.getByText('To apply your updated settings to this site, reload this page')
    await expect(offer).toHaveCount(0)
    await panel.getByRole('combobox', { name: /Location/ }).selectOption('deny')
    await expect(offer).toBeVisible()

    // Each tab that showed a page of the website then offers it while it shows that page, as another tab showing,
    // which closes Site controls, leaves it.
    const openSiteControlsOn = async (tabId: string) => {
      await selectTab(tabId)
      await expect(panel).toHaveCount(0)
      await siteControls.click()
      await expect(panel.getByRole('combobox', { name: /Location/ })).toHaveValue('deny')
    }
    await openSiteControlsOn(tabs.other)
    await expect(offer).toBeVisible()
    await openSiteControlsOn(tabs.page)
    await expect(offer).toBeVisible()

    // The page loads again, which closes Site controls, as a page the tab goes on to does; opened again, they offer
    // nothing more there, while the other tab, whose page did not load again, still offers it.
    await panel.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect.poll(() => loads).toBe(2)
    await expect(panel).toHaveCount(0)
    await siteControls.click()
    await expect(panel.getByRole('combobox', { name: /Location/ })).toHaveValue('deny')
    await expect(offer).toHaveCount(0)
    expect(loads).toBe(2)
    await openSiteControlsOn(tabs.other)
    await expect(offer).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})
