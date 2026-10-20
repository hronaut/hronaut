import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type PickerProbe = typeof globalThis & { heldEnterPicker?: { fills: string[]; restore(): void } }

// Synthetic account metadata opens the account picker without an OS vault, and the stubbed fill records the account.
test('a held Enter on Fill saved password leaves the choice of account to the picker', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Held Enter picker</title><form><input name="user" autocomplete="username"><input type="password" autocomplete="current-password"></form>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing account picker fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    await electronApp.evaluate(({ ipcMain }, origin) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const originals = ['credentials:status', 'credentials:list', 'credentials:fill'].map(channel => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`Missing fixture handler: ${channel}`)
        return { channel, handler }
      })
      for (const { channel } of originals) ipcMain.removeHandler(channel)
      const fills: string[] = []
      ipcMain.handle('credentials:status', () => ({ available: true, backend: 'synthetic metadata fixture' }))
      ipcMain.handle('credentials:list', () => ['alice', 'bob'].map(username => ({
        id: username, username, origin, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z'
      })))
      ipcMain.handle('credentials:fill', (_event, _tabId: string, id: string) => {
        fills.push(id)
        return true
      })
      ;(globalThis as PickerProbe).heldEnterPicker = {
        fills,
        restore: () => {
          for (const { channel, handler } of originals) {
            ipcMain.removeHandler(channel)
            ipcMain.handle(channel, handler)
          }
        }
      }
    }, origin)
    await appWindow.reload()
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/`)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Held Enter picker')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    const fill = appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Fill saved password and pause agents', exact: true })
    await expect(fill).toBeEnabled()
    await fill.focus()
    await expect(fill).toBeFocused()

    const picker = appWindow.getByRole('dialog', { name: 'Choose an account', exact: true })
    const search = picker.getByRole('combobox', { name: 'Search saved accounts', exact: true })
    const fills = () => electronApp.evaluate(() => (globalThis as PickerProbe).heldEnterPicker!.fills.slice())
    await appWindow.keyboard.down('Enter')
    await expect(search).toBeFocused()
    for (let repeat = 0; repeat < 6; repeat += 1) {
      // Repeats at about a keyboard's pace.
      await appWindow.waitForTimeout(50)
      await appWindow.keyboard.down('Enter')
    }
    await appWindow.keyboard.up('Enter')
    expect(await fills()).toEqual([])
    await expect(picker).toBeVisible()

    await appWindow.keyboard.press('ArrowDown')
    await appWindow.keyboard.press('Enter')
    await expect.poll(fills).toEqual(['bob'])
  } finally {
    await electronApp.evaluate(() => {
      (globalThis as PickerProbe).heldEnterPicker?.restore()
      delete (globalThis as PickerProbe).heldEnterPicker
    })
    await closeFixtureServer(server)
  }
})
