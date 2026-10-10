import { expect, test } from './fixtures.js'

type CredentialFocusProbe = typeof globalThis & {
  credentialFocusProbe?: { release(): void; restore(): void }
}

for (const mode of ['neighbor', 'heading', 'retained'] as const) {
  test(`does not claim native focus after saved-password ${mode} recovery`, async ({ appWindow, electronApp }) => {
    let humanWindowId: number | undefined
    await electronApp.evaluate(({ ipcMain }, single) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const channels = ['credentials:status', 'credentials:list', 'credentials:remove']
      const originals = channels.map(channel => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`Missing fixture handler: ${channel}`)
        return { channel, handler }
      })
      let entries = (single ? ['Alpha'] : ['Alpha', 'Middle', 'Zulu']).map(username => ({
        id: username, username, origin: 'https://focus.example',
        createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z'
      }))
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      for (const channel of channels) ipcMain.removeHandler(channel)
      ipcMain.handle('credentials:status', () => ({ available: true, backend: 'synthetic metadata fixture' }))
      ipcMain.handle('credentials:list', () => entries)
      ipcMain.handle('credentials:remove', async (_event, id: string) => {
        await pending
        entries = entries.filter(entry => entry.id !== id)
        return true
      })
      ;(globalThis as CredentialFocusProbe).credentialFocusProbe = { release, restore: () => {
        release()
        for (const { channel, handler } of originals) {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, handler)
        }
      } }
    }, mode === 'heading')
    try {
      await appWindow.reload()
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      await appWindow.getByRole('button', { name: 'Passwords Saved accounts', exact: true }).click()
      const panel = appWindow.locator('.credentials-settings')
      const remove = (username: string) => panel.getByRole('button', { name: `Remove saved password for ${username} on https://focus.example`, exact: true })
      const removed = mode === 'heading' ? 'Alpha' : 'Middle'
      await expect(panel.locator('.credential-remove')).toHaveCount(mode === 'heading' ? 1 : 3)
      await remove(removed).focus()
      await appWindow.keyboard.press('Enter')
      await expect(remove(removed)).toHaveAttribute('aria-disabled', 'true')
      if (mode === 'retained') await remove('Zulu').focus()
      await appWindow.evaluate(() => {
        const original = HTMLElement.prototype.focus
        const probe = { calls: 0, restore: () => { HTMLElement.prototype.focus = original } }
        ;(window as typeof window & { credentialNativeFocus?: typeof probe }).credentialNativeFocus = probe
        HTMLElement.prototype.focus = function (options?: FocusOptions) {
          if (this.closest('.credentials-settings')) probe.calls += 1
          original.call(this, options)
        }
      })
      humanWindowId = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const human = new BrowserWindow({ width: 320, height: 200, show: false })
        await human.loadURL('data:text/html,<title>Human focus owner</title><input autofocus>')
        human.show()
        human.focus()
        return human.id
      })
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanWindowId)
      await expect.poll(() => appWindow.evaluate('window.hronautShell.isWindowFocused()')).toBe(false)
      await electronApp.evaluate(() => { (globalThis as CredentialFocusProbe).credentialFocusProbe?.release() })
      await expect(remove(removed)).toHaveCount(0)
      await expect(panel.locator('.credential-remove')).toHaveCount(mode === 'heading' ? 0 : 2)
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.evaluate(() => (window as typeof window & { credentialNativeFocus?: { calls: number } }).credentialNativeFocus?.calls)).toBe(0)
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanWindowId)
    } finally {
      await appWindow.evaluate(() => {
        const scope = window as typeof window & { credentialNativeFocus?: { restore(): void } }
        scope.credentialNativeFocus?.restore()
        delete scope.credentialNativeFocus
      })
      if (humanWindowId !== undefined) await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), humanWindowId)
      await electronApp.evaluate(() => {
        const scope = globalThis as CredentialFocusProbe
        scope.credentialFocusProbe?.restore()
        delete scope.credentialFocusProbe
      })
    }
  })
}
