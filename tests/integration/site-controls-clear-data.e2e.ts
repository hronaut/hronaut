import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Site controls named "Clear data for this website" nowhere and the person could not delete a website's sign-in
// cookies or storage short of deleting the workspace. As in Chrome, Site controls now clear them, after asking.
test('Site controls clear the website’s cookies and storage, after asking, and offer to reload the page', async ({ appWindow }) => {
  const cookieHeaders: (string | undefined)[] = []
  const server = createServer((request, response) => {
    if (request.url !== '/') {
      response.writeHead(404)
      response.end()
      return
    }
    cookieHeaders.push(request.headers.cookie)
    response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=signed-in; HttpOnly; Path=/' })
    response.end('<!doctype html><title>Loading</title><script>document.title = localStorage.getItem("kept") ?? "Nothing kept";'
      + 'localStorage.setItem("kept", "Storage kept")</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    await appWindow.evaluate(async (site) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const created = await api.createWorkspace({ name: 'Clear data', storage: 'scratch' })
      const workspaceId = created.mcpTabGroups.find(group => group.name === 'Clear data')!.id
      await api.newTab({ url: `${site}/`, mcpGroupId: workspaceId, active: true })
    }, site)
    const activeTitle = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.id === state.activeTabId && !tab.loading)?.title))
    await expect.poll(activeTitle).toBe('Nothing kept')

    const siteControls = appWindow.getByRole('button', { name: 'Site controls for 127.0.0.1', exact: true })
    await siteControls.click()
    const panel = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    await expect(panel.getByRole('article', { name: /^1 cookie available/ })).toBeVisible()
    await panel.getByRole('button', { name: 'Clear data for this website' }).click()
    await expect(panel.getByText(`Delete cookies and site data for ${site}? You may be signed out of this website.`)).toBeVisible()
    await panel.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(panel.getByRole('article', { name: /^0 cookies? available/ })).toBeVisible()
    await expect(panel.getByText('To apply your updated settings to this site, reload this page')).toBeVisible()

    // The page loads again without its sign-in cookie or what it stored.
    await panel.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect.poll(() => cookieHeaders.length).toBe(2)
    expect(cookieHeaders).toEqual([undefined, undefined])
    await expect.poll(activeTitle).toBe('Nothing kept')
  } finally {
    await closeFixtureServer(server)
  }
})
