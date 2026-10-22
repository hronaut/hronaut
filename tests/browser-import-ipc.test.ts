import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
const state = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(), discover: vi.fn(), read: vi.fn() }))
// The handlers register on the ipcMain index.ts passes, never on Electron's own, which Hronaut's pages would get English errors from.
vi.mock('electron', () => ({}))
const ipcMain = { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { state.handlers.set(name, handler) } } as unknown as Pick<IpcMain, 'handle'>
vi.mock('../src/main/browser-import/source.js', async importOriginal => ({ ...await importOriginal<object>(), discoverImportProfiles: state.discover, readImportCookies: state.read }))
import { registerBrowserImportIpc } from '../src/main/browser-import/ipc.js'
beforeEach(() => { state.handlers.clear(); state.discover.mockReset(); state.read.mockReset() })
it('rejects discovery, preview, cancel and commit from untrusted senders before touching profiles', async () => {
  const cancel = registerBrowserImportIpc({ ipcMain, assertSender: () => { throw new Error('untrusted') }, destination: id => ({ id, name: 'Work', fingerprint: 'one' }), consent: async () => true, write: vi.fn() })
  try {
    for (const [channel, handler] of state.handlers) {
      await expect(Promise.resolve().then(() => handler({}, 'id', ['site.test'])), channel).rejects.toThrow('untrusted')
    }
    expect(state.discover).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled()
  } finally { cancel() }
})
it('sanitizes source failures and rejects arbitrary profile identifiers before reading', async () => {
  const cancel = registerBrowserImportIpc({ ipcMain, assertSender: () => {}, destination: id => ({ id, name: 'Work', fingerprint: 'one' }), consent: async () => true, write: vi.fn() })
  try {
    state.discover.mockRejectedValue(new Error('/private/path with cookie secret'))
    expect(await state.handlers.get('browser-import:list')!({}, 'workspace')).toEqual({ ok: false, error: 'failed' })
    expect(await state.handlers.get('browser-import:preview')!({}, 'workspace', '/arbitrary/path')).toEqual({ ok: false, error: 'expired' })
    expect(state.read).not.toHaveBeenCalled()
  } finally { cancel() }
})
it('lists profiles from the folders CHROME_CONFIG_HOME and XDG_CONFIG_HOME name', async () => {
  const saved = { CHROME_CONFIG_HOME: process.env.CHROME_CONFIG_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
  process.env.CHROME_CONFIG_HOME = '/data/chrome'; process.env.XDG_CONFIG_HOME = '/data/config'
  const cancel = registerBrowserImportIpc({ ipcMain, assertSender: () => {}, destination: id => ({ id, name: 'Work', fingerprint: 'one' }), consent: async () => true, write: vi.fn() })
  try {
    state.discover.mockResolvedValue([])
    expect(await state.handlers.get('browser-import:list')!({}, 'workspace')).toEqual({ ok: true, value: [] })
    expect(state.discover).toHaveBeenCalledWith(expect.any(String), process.platform, '/data/config', '/data/chrome')
  } finally {
    cancel()
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
