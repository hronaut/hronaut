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
    type State = { activeTabId: string, tabs: Array<{ id: string, url: string, active: boolean, mcpGroupId?: string }> }
    const open = (path: string) => appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    // The person's + button in the workspace's row, which opens an empty tab.
    const newTab = async () => (await appWindow.evaluate(`window.hronaut.newTab({ mcpGroupId: ${JSON.stringify(workspace)}, active: true })`) as State).activeTabId
    const state = () => appWindow.evaluate(`window.hronaut.getState()`) as Promise<State>
    const order = async () => (await state()).tabs.filter(tab => tab.mcpGroupId === workspace)
      .map(tab => `${tab.url.startsWith(origin) ? new URL(tab.url).pathname : 'new'}${tab.active ? '*' : ''}`)
    const tabId = async (path: string) => (await state()).tabs.find(tab => tab.url === origin + path)!.id
    const select = async (path: string) => appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(await tabId(path))})`)
    const close = (id: string) => appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(id)})`)
    await open('/one')
    await open('/two')
    await open('/three')
    // The workspace's own first tab.
    await close((await state()).tabs.find(tab => tab.mcpGroupId === workspace && !tab.url.startsWith(origin))!.id)
    await select('/one')
    await expect.poll(order).toEqual(['/one*', '/two', '/three'])

    // It showed the workspace's last tab, beside the new tab.
    const first = await newTab()
    await expect.poll(order).toEqual(['/one', '/two', '/three', 'new*'])
    await close(first)
    await expect.poll(order).toEqual(['/one*', '/two', '/three'])

    // A second new tab returns to the first, which another tab then showed in front of, so it closes as any tab.
    const outer = await newTab()
    const inner = await newTab()
    await expect.poll(order).toEqual(['/one', '/two', '/three', 'new', 'new*'])
    await close(inner)
    await expect.poll(async () => (await state()).activeTabId).toBe(outer)
    await close(outer)
    await expect.poll(order).toEqual(['/one', '/two', '/three*'])

    // So does a new tab the person left for another tab and came back to.
    await select('/one')
    const left = await newTab()
    await select('/two')
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(left)})`)
    await close(left)
    await expect.poll(order).toEqual(['/one', '/two', '/three*'])

    // Typing an address into the new tab keeps the way back.
    await select('/two')
    const typed = await newTab()
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/typed`)}, tabId: ${JSON.stringify(typed)} })`)
    await expect.poll(order).toEqual(['/one', '/two', '/three', '/typed*'])
    await close(typed)
    await expect.poll(order).toEqual(['/one', '/two*', '/three'])
  } finally {
    await closeFixtureServer(server)
  }
})
