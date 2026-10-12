import { createServer } from 'node:http'
import type { HronautCredentialsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Synthetic account metadata exercises native chooser UI without opening an OS vault or filling secrets.
for (const control of ['close', 'account', 'search', 'removed', 'reopen'] as const) {
test(`preserves account chooser ${control} focus through live synthetic metadata`, async ({ appWindow, electronApp }) => {
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
      const originals = ['credentials:status', 'credentials:list', 'credentials:fill'].map(channel => {
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
      const scope = globalThis as typeof globalThis & { pickerFocusFillAttempts?: number }
      scope.pickerFocusFillAttempts = 0
      ipcMain.handle('credentials:fill', () => {
        scope.pickerFocusFillAttempts! += 1
        throw new Error('Credential filling is forbidden in this metadata-only fixture')
      })
      ipcMain.once('qa:restore-picker-search', () => {
        delete scope.pickerFocusFillAttempts
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
    const close = picker.getByRole('button', { name: 'Close account chooser', exact: true })
    const bob = picker.getByRole('option', { name: /Bob Smith/ })
    await expect(search).toBeFocused()
    let broadcastCount = 0
    await appWindow.evaluate(() => {
      const probe = { count: 0 }
      const dispose = (window as typeof window & { hronautCredentials: HronautCredentialsApi }).hronautCredentials.onChanged(() => { probe.count += 1 })
      ;(window as typeof window & { accountFocusProbe?: { count: number; dispose(): void } }).accountFocusProbe = Object.assign(probe, { dispose })
    })
    const broadcast = async (names: string[]) => {
      await electronApp.evaluate(({ BrowserWindow }, { origin, names }) => {
        const entries = names.map(username => ({
          id: username.replace(/ .*/, '').toLowerCase(), username,
          origin: username === 'Foreign Smith' ? 'https://foreign.test' : origin,
          createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z'
        }))
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('credentials:changed', entries)
      }, { origin, names })
      broadcastCount += 1
      await expect.poll(() => appWindow.evaluate(() => (window as typeof window & { accountFocusProbe?: { count: number } }).accountFocusProbe?.count)).toBe(broadcastCount)
      // The subscription receipt precedes Vue's DOM/focus callbacks; allow that render to settle.
      await expect.poll(() => picker.getByRole('option').count()).toBe(names.filter(name => name !== 'Foreign Smith').length)
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    }
    if (control === 'removed') {
      await bob.focus()
      await broadcast(['Alice Smith'])
      await expect(search).toBeFocused()
      await picker.getByRole('option', { name: /Alice Smith/ }).focus()
      await broadcast([])
      await expect(search).toBeFocused()
      await expect(search).not.toHaveAttribute('aria-activedescendant')
      return
    }
    if (control === 'reopen') {
      await close.focus()
      await appWindow.keyboard.press('Enter')
      await expect(picker).toHaveCount(0)
      await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
      await appWindow.getByRole('button', { name: 'Fill saved password and pause agents', exact: true }).click()
      await expect(picker).toBeVisible()
      await expect(search).toBeFocused()
      await appWindow.keyboard.press('Escape')
      await expect(picker).toHaveCount(0)
      return
    }
    const target = control === 'close' ? close : control === 'account' ? bob : search
    await target.focus()
    await expect(target).toBeFocused()
    for (const names of [
      ['Alice Smith', 'Bob Smith', 'Carol Jones', 'Foreign Smith'],
      ['Alice Smith', 'Bob Smith', 'Carol Jones'],
      ['Bob Smith', 'Carol Jones', 'Alice Smith'],
      ['Bob Smith', 'Alice Smith']
    ]) {
      await broadcast(names)
      await expect(target).toBeFocused()
    }
    if (control === 'close') {
      await appWindow.keyboard.press('Enter')
      await expect(picker).toHaveCount(0)
    } else if (control === 'search') {
      await search.fill('smith 127.0.0.1')
      await expect(picker.getByRole('option')).toHaveCount(2)
      await expect(search).toHaveAttribute('aria-activedescendant', 'credential-option-alice')
      await appWindow.keyboard.press('ArrowDown')
      await expect(search).toHaveAttribute('aria-activedescendant', 'credential-option-bob')
      await appWindow.keyboard.press('Escape')
      await expect(picker).toHaveCount(0)
    } else {
      await appWindow.keyboard.press('Shift+Tab')
      await expect(search).toBeFocused()
      await appWindow.keyboard.press('Escape')
      await expect(picker).toHaveCount(0)
    }

  } finally {
    try {
      expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { pickerFocusFillAttempts?: number }).pickerFocusFillAttempts)).toBe(0)
      await appWindow.evaluate(() => {
        const scope = window as typeof window & { accountFocusProbe?: { dispose(): void } }
        scope.accountFocusProbe?.dispose()
        delete scope.accountFocusProbe
      })
    } finally {
      try {
        await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:restore-picker-search'))
      } finally {
        await closeFixtureServer(server)
      }
    }
  }
})

}
