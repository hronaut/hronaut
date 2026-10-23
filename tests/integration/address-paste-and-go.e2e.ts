import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type TabState = { id: string; url: string }

// The native menu cannot be read from the page, so the test records the menu Hronaut pops up and chooses its items in
// the main process, as shell-edit-context-menu.e2e.ts does.
test('the address bar\'s menu offers Paste and Go after Paste, as Chrome\'s does, and opens the clipboard text in the tab', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Page ${request.url}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address()
  if (!port || typeof port === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${port.port}`
  try {
    await electronApp.evaluate(({ Menu }) => {
      const shown: Electron.Menu[] = []
      Object.assign(globalThis, { shownAddressMenus: shown })
      Menu.prototype.popup = function popup(this: Electron.Menu) { shown.push(this) }
    })
    const menuCount = () => electronApp.evaluate(() => (globalThis as unknown as { shownAddressMenus: Electron.Menu[] }).shownAddressMenus.length)
    const lastMenu = () => electronApp.evaluate(() => {
      const shown = (globalThis as unknown as { shownAddressMenus: Electron.Menu[] }).shownAddressMenus
      return shown.at(-1)?.items.filter(item => item.type !== 'separator').map(item => ({ id: item.id, label: item.label, enabled: item.enabled })) ?? null
    })
    const choose = (id: string) => electronApp.evaluate((_electron, itemId) => {
      const shown = (globalThis as unknown as { shownAddressMenus: Electron.Menu[] }).shownAddressMenus
      const item = shown.at(-1)!.items.find(candidate => candidate.id === itemId)!
      ;(item.click as () => void)()
    }, id)
    const tabUrl = async (): Promise<string> => ((await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: TabState[] }).tabs
      .find(tab => tab.id === tabId)!.url)
    const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    const openMenuWith = async (clipboardText: string) => {
      await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardText)
      const before = await menuCount()
      await address.click({ button: 'right' })
      await expect.poll(menuCount).toBe(before + 1)
      return (await lastMenu())!
    }

    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/start`)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(tabUrl).toBe(`${origin}/start`)

    // An address split over lines reads whole, as Chrome reads a paste, and opens in the tab.
    const emojiPicker = await electronApp.evaluate(({ app }) => app.isEmojiPanelSupported() ? [process.platform === 'darwin' ? 'Emoji && Symbols' : 'Emoji'] : [])
    const menu = await openMenuWith(`  ${origin}/pas\n   ted  `)
    expect(menu.map(item => item.label)).toEqual([...emojiPicker, 'Undo', 'Redo', 'Cut', 'Copy', 'Paste', `Paste and Go to ${origin}/pasted`, 'Delete', 'Select All'])
    expect(menu.find(item => item.id === 'paste-and-go')!.enabled).toBe(true)
    await choose('paste-and-go')
    await expect.poll(tabUrl).toBe(`${origin}/pasted`)
    await expect(address).toHaveValue(`${origin}/pasted`)

    // Text that is no address is searched for, lines of words keeping their spaces, and script loses its scheme, so it
    // is searched for, never run.
    expect((await openMenuWith('hronaut browser\nfor agents')).find(item => item.id === 'paste-and-go'))
      .toEqual({ id: 'paste-and-go', label: 'Paste and Search for “hronaut browser for agents”', enabled: true })
    expect((await openMenuWith('javascript:alert(1)')).find(item => item.id === 'paste-and-go'))
      .toEqual({ id: 'paste-and-go', label: 'Paste and Search for “alert(1)”', enabled: true })
    // With nothing to open, the item stays in its place, disabled.
    expect((await openMenuWith(' \n ')).find(item => item.id === 'paste-and-go')).toEqual({ id: 'paste-and-go', label: 'Paste and Go', enabled: false })
    expect(await tabUrl()).toBe(`${origin}/pasted`)
  } finally {
    await closeFixtureServer(server)
  }
})
