import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Synthetic account metadata exercises native chooser UI without opening an OS vault or filling secrets.
test('combines account and site search terms within the active website account chooser', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Account chooser search fixture</title>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing account chooser fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    await electronApp.evaluate(({ ipcMain }, origin) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const originals = ['credentials:status', 'credentials:list'].map(channel => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`Missing fixture handler: ${channel}`)
        return { channel, handler }
      })
      const entries = ['Alice Smith', 'Bob Smith', 'Carol Jones'].map(username => ({
        id: username.replace(/ .*/, '').toLowerCase(), username, origin,
        createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z'
      }))
      entries.push({ id: 'foreign', username: 'Foreign Smith', origin: 'https://foreign.test', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' })
      for (const { channel } of originals) ipcMain.removeHandler(channel)
      ipcMain.handle('credentials:status', () => ({ available: true, backend: 'synthetic metadata fixture' }))
      ipcMain.handle('credentials:list', () => entries)
      ipcMain.once('qa:restore-picker-search', () => {
        for (const { channel, handler } of originals) {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, handler)
        }
      })
    }, origin)
    await appWindow.reload()
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Account chooser search fixture')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Fill saved password and pause agents', exact: true }).click()
    const picker = appWindow.getByRole('dialog', { name: 'Choose an account', exact: true })
    const search = picker.getByRole('combobox', { name: 'Search saved accounts', exact: true })
    await expect(picker.getByRole('option')).toHaveCount(3)
    await search.fill('SMITH 127.0.0.1')
    await expect(picker.getByRole('option')).toHaveCount(2)
    await expect(picker.getByRole('option', { name: /Alice Smith/ })).toHaveAttribute('aria-selected', 'true')
    await appWindow.keyboard.press('ArrowDown')
    const bob = picker.getByRole('option', { name: /Bob Smith/ })
    await expect(bob).toHaveAttribute('aria-selected', 'true')
    await expect(search).toHaveAttribute('aria-activedescendant', 'credential-option-bob')
    await search.fill('Foreign Smith')
    await expect(picker.getByRole('option')).toHaveCount(0)
    await expect(picker.getByText('No matching accounts', { exact: true })).toBeVisible()
    await search.fill('')
    await expect(picker.getByRole('option')).toHaveCount(3)
    await appWindow.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
  } finally {
    try {
      await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:restore-picker-search'))
    } finally {
      await closeFixtureServer(server)
    }
  }
})
