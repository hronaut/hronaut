import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('closing a new tab right away shows the tab the person was on, as in Chrome', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url}</title>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Tabs', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Tabs')!.id
    // The person's + button in the workspace's row; the workspace's own first tab, about:blank, is left out below.
    const newTab = (path: string) => appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    const tabs = async () => (await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ id: string, url: string, active: boolean, mcpGroupId?: string }> })
      .tabs.filter(tab => tab.mcpGroupId === workspace && tab.url.startsWith(origin))
    const order = async () => (await tabs()).map(tab => `${new URL(tab.url).pathname}${tab.active ? '*' : ''}`)
    const tabId = async (path: string) => (await tabs()).find(tab => new URL(tab.url).pathname === path)!.id
    const select = async (path: string) => appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(await tabId(path))})`)
    const close = async (path: string) => appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(await tabId(path))})`)
    await newTab('/one')
    await newTab('/two')
    await newTab('/three')
    await select('/one')
    await expect.poll(order).toEqual(['/one*', '/two', '/three'])

    // It showed the workspace's last tab, beside the new tab.
    await newTab('/new')
    await expect.poll(order).toEqual(['/one', '/two', '/three', '/new*'])
    await close('/new')
    await expect.poll(order).toEqual(['/one*', '/two', '/three'])

    // Going to another tab of the workspace first leaves the new tab, which then closes as any tab.
    await newTab('/new')
    await select('/two')
    await select('/new')
    await close('/new')
    await expect.poll(order).toEqual(['/one', '/two', '/three*'])

    // Typing an address into the new tab keeps the way back.
    await select('/two')
    await newTab('/new')
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/typed`)}, tabId: ${JSON.stringify(await tabId('/new'))} })`)
    await expect.poll(order).toEqual(['/one', '/two', '/three', '/typed*'])
    await close('/typed')
    await expect.poll(order).toEqual(['/one', '/two*', '/three'])
  } finally {
    await closeFixtureServer(server)
  }
})
