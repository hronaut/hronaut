import { expect, test } from './fixtures.js'

// Exercise native keyboard focus with synthetic metadata, independent of OS vault availability.
test('keeps keyboard position when removing saved-password rows', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const channels = ['credentials:status', 'credentials:list', 'credentials:remove']
    const originals = channels.map(channel => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing fixture handler: ${channel}`)
      return { channel, handler }
    })
    let entries = ['Alpha', 'Middle', 'Zulu'].map(username => ({
      id: username, username, origin: 'https://focus.example',
      createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z'
    }))
    for (const channel of channels) ipcMain.removeHandler(channel)
    ipcMain.handle('credentials:status', () => ({ available: true, backend: 'synthetic metadata fixture' }))
    ipcMain.handle('credentials:list', () => entries)
    ipcMain.handle('credentials:remove', (_event, id: string) => {
      const before = entries.length
      entries = entries.filter(entry => entry.id !== id)
      return entries.length !== before
    })
    ipcMain.once('qa:restore-credential-focus', () => {
      for (const { channel, handler } of originals) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
    })
  })
  try {
    await appWindow.reload()
    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Passwords Saved accounts', exact: true }).click()
    const panel = appWindow.locator('.credentials-settings')
    const remove = (username: string) => panel.getByRole('button', { name: `Remove saved password for ${username} on https://focus.example`, exact: true })
    await expect(panel.locator('.credential-remove')).toHaveCount(3)
    const search = panel.getByRole('searchbox', { name: 'Search saved passwords', exact: true })
    await search.fill('FOCUS.example middle')
    await expect(panel.locator('.credential-remove')).toHaveCount(1)
    await expect(remove('Middle')).toBeVisible()
    await expect(panel.getByRole('status')).toHaveText('1 of 3 saved passwords')
    await search.fill('Alpha Zulu')
    await expect(panel.locator('.credential-remove')).toHaveCount(0)
    await expect(panel.getByText('No saved passwords match this search.', { exact: true })).toBeVisible()
    await search.fill('')
    await expect(panel.locator('.credential-remove')).toHaveCount(3)
    await remove('Middle').focus()
    for (const { username, next, remaining } of [
      { username: 'Middle', next: 'Zulu', remaining: 2 },
      { username: 'Zulu', next: 'Alpha', remaining: 1 },
      { username: 'Alpha', next: null, remaining: 0 }
    ]) {
      await appWindow.keyboard.press('Enter')
      await expect(remove(username)).toHaveCount(0)
      await expect(panel.locator('.credential-remove')).toHaveCount(remaining)
      if (next) await expect(remove(next)).toBeFocused()
      else await expect(panel.getByRole('heading', { name: 'Saved passwords', exact: true })).toBeFocused()
    }
    await expect(panel.getByText('No saved passwords', { exact: true })).toBeVisible()
  } finally {
    await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:restore-credential-focus'))
  }
})
