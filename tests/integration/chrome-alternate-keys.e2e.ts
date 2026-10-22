import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('F5, Shift+F5, Ctrl+Page Up and Down and Alt+D work as in Chrome', async ({ appWindow, electronApp }) => {
  const loads: Array<{ path: string, cacheControl: string | undefined }> = []
  const server = createServer((request, response) => {
    loads.push({ path: request.url ?? '', cacheControl: request.headers['cache-control'] })
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url}</title>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Keys', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Keys')!.id
    const open = (path: string) => appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    const shown = async () => {
      const state = await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ url: string, active: boolean }> }
      const url = state.tabs.find(tab => tab.active)?.url ?? ''
      return url.startsWith(origin) ? new URL(url).pathname : url
    }
    const loadsOf = (path: string) => loads.filter(load => load.path === path)
    // The person's key on the page in view, as the keyboard sends it.
    const press = async (keyCode: string, modifiers: Array<'shift' | 'control' | 'alt'> = []) => electronApp.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url: origin + await shown(), keyCode, modifiers })
    await open('/one')
    await open('/two')
    await expect.poll(shown).toBe('/two')
    await expect.poll(() => loadsOf('/two').length).toBe(1)

    await press('F5')
    await expect.poll(() => loadsOf('/two').length).toBe(2)
    expect(loadsOf('/two')[1]!.cacheControl).not.toBe('no-cache')
    await press('F5', ['shift'])
    await expect.poll(() => loadsOf('/two').length).toBe(3)
    expect(loadsOf('/two')[2]!.cacheControl).toBe('no-cache')
    await press('F5', ['control'])
    await expect.poll(() => loadsOf('/two').length).toBe(4)
    expect(loadsOf('/two')[3]!.cacheControl).toBe('no-cache')

    await press('PageUp', ['control'])
    await expect.poll(shown).toBe('/one')
    await press('PageDown', ['control'])
    await expect.poll(shown).toBe('/two')

    const addressBar = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    await expect(addressBar).not.toBeFocused()
    await press('D', ['alt'])
    await expect(addressBar).toBeFocused()

    // From Hronaut's own window too.
    await appWindow.keyboard.press('Control+PageUp')
    await expect.poll(shown).toBe('/one')
  } finally {
    await closeFixtureServer(server)
  }
})
