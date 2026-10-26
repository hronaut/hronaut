import type { IpcMain, IpcMainInvokeEvent, Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {}, session: { fromPartition: vi.fn() } }))

const { createSpellCheck, registerSpellCheckIpc } = await import('../src/main/spell-check.js')
const { createBrowserSession } = await import('../src/main/browser-session.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings-store.js')
const { commitRuntimeSetting } = await import('../src/main/runtime-setting-commit.js')

// Websites' text fields always checked spelling: Hronaut had no way to turn it off, as Chrome's Spell check switch
// does. Every browser session now follows one setting, from Settings or a text field's menu.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function spellCheckRuntime(saved: Partial<AppSettings> = {}) {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...saved }
  let saveFails = false
  let saving: (() => void) | undefined
  const order: string[] = []
  const host = {
    settings: () => settings,
    // As settings-runtime does: the runtime change first, then the save, with the previous setting put back on failure.
    updateSettings: vi.fn(async (updates: Partial<AppSettings>, applyRuntime?: (value: AppSettings) => void | Promise<void>) => {
      const next = { ...settings, ...updates }
      await commitRuntimeSetting({
        previous: settings,
        next,
        apply: applyRuntime ?? (() => undefined),
        persist: async () => {
          saving?.()
          if (saveFails) throw new Error('disk full')
        }
      })
      settings = next
      return settings
    }),
    publishSettings: vi.fn(() => { order.push('published') })
  }
  const spellCheck = createSpellCheck(host)
  const session = () => {
    const calls: boolean[] = []
    return { calls, setSpellCheckerEnabled: (enabled: boolean) => { calls.push(enabled); order.push(`session ${enabled}`) } }
  }
  return {
    spellCheck, host, session, order,
    settings: () => settings,
    failSaves: () => { saveFails = true },
    whileSaving: (action: () => void) => { saving = action }
  }
}

describe('spell check', () => {
  it('has each session check spelling as the setting says when it is tracked, once', () => {
    const on = spellCheckRuntime()
    const first = on.session()
    on.spellCheck.track(first)
    on.spellCheck.track(first)
    expect(first.calls).toEqual([true])

    const off = spellCheckRuntime({ spellCheck: false })
    const second = off.session()
    off.spellCheck.track(second)
    expect(second.calls).toEqual([false])
  })

  it('turns every tracked session off and on, saves the setting and then tells the shells', async () => {
    const runtime = spellCheckRuntime()
    const workspace = runtime.session()
    const home = runtime.session()
    runtime.spellCheck.track(workspace)
    runtime.spellCheck.track(home)
    runtime.order.length = 0

    await expect(runtime.spellCheck.setEnabled(false)).resolves.toMatchObject({ spellCheck: false })
    expect(runtime.settings().spellCheck).toBe(false)
    expect(runtime.order).toEqual(['session false', 'session false', 'published'])

    await runtime.spellCheck.setEnabled(true)
    expect(workspace.calls).toEqual([true, false, true])
    expect(home.calls).toEqual([true, false, true])
  })

  it('gives a session tracked while the change saves the new value, not the one still saved', async () => {
    const runtime = spellCheckRuntime()
    const late = runtime.session()
    runtime.whileSaving(() => runtime.spellCheck.track(late))
    await runtime.spellCheck.setEnabled(false)
    expect(late.calls).toEqual([false])
  })

  it('reads as the value a change applied while that change still saves, and as the saved one after a failure', async () => {
    const runtime = spellCheckRuntime()
    const seen: boolean[] = []
    runtime.whileSaving(() => { seen.push(runtime.spellCheck.isEnabled()) })
    await runtime.spellCheck.setEnabled(false)
    expect(seen).toEqual([false])
    expect(runtime.spellCheck.isEnabled()).toBe(false)

    runtime.failSaves()
    await expect(runtime.spellCheck.setEnabled(true)).rejects.toThrow('disk full')
    expect(seen).toEqual([false, true])
    expect(runtime.spellCheck.isEnabled()).toBe(false)
  })

  it('checks spelling in every session the browser sets up, once each, after its permission handlers', () => {
    const runtime = spellCheckRuntime({ spellCheck: false })
    const steps: string[] = []
    const browserSession = createBrowserSession({
      text: (key) => key,
      effectiveDownloadDirectory: () => '',
      showDialog: async () => ({ response: 0 }),
      workspaces: () => [],
      state: { persistentSession: null, sitePermissionStore: null },
      sendToShellWindows: () => undefined,
      partition: 'persist:test',
      websitesMaySaveFiles: () => false,
      trackSpellCheck: (session) => runtime.spellCheck.track(session)
    })
    const fakeSession = (name: string) => ({
      setDownloadPath: () => undefined,
      setPermissionCheckHandler: () => { steps.push(`${name} check handler`) },
      setPermissionRequestHandler: () => { steps.push(`${name} request handler`) },
      on: () => undefined,
      setSpellCheckerEnabled: (enabled: boolean) => { steps.push(`${name} spell check ${enabled}`) }
    }) as unknown as Session
    const workspace = fakeSession('workspace')
    const home = fakeSession('home')
    browserSession.configureBrowserSession(workspace, 'workspace')
    browserSession.configureBrowserSession(workspace, 'workspace')
    browserSession.configureBrowserSession(home)
    expect(steps).toEqual([
      'workspace check handler', 'workspace request handler', 'workspace spell check false',
      'home check handler', 'home request handler', 'home spell check false'
    ])
  })

  it('puts the sessions back when the setting cannot be saved', async () => {
    const runtime = spellCheckRuntime()
    const workspace = runtime.session()
    runtime.spellCheck.track(workspace)
    runtime.failSaves()
    await expect(runtime.spellCheck.setEnabled(false)).rejects.toThrow('disk full')
    expect(workspace.calls).toEqual([true, false, true])
    expect(runtime.settings().spellCheck).toBe(true)
    expect(runtime.host.publishSettings).not.toHaveBeenCalled()
    // A session tracked after the failure gets the setting that stayed.
    const later = runtime.session()
    runtime.spellCheck.track(later)
    expect(later.calls).toEqual([true])
  })

  it('takes only a boolean from a trusted shell over IPC', async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
    const setEnabled = vi.fn(async (enabled: boolean) => ({ ...DEFAULT_SETTINGS, spellCheck: enabled }))
    const assertTrustedSender = vi.fn((event: IpcMainInvokeEvent) => {
      if ((event as unknown as { untrusted?: boolean }).untrusted) throw new Error('untrusted sender')
    })
    registerSpellCheckIpc(ipcMain, { assertTrustedSender, setEnabled })
    const invoke = (event: object, value: unknown) => Promise.resolve().then(() => handlers.get('settings:set-spell-check')!(event as IpcMainInvokeEvent, value))

    await expect(invoke({}, false)).resolves.toMatchObject({ spellCheck: false })
    expect(setEnabled).toHaveBeenLastCalledWith(false)
    await expect(invoke({}, 'off')).rejects.toThrow('Spell check must be a boolean')
    await expect(invoke({ untrusted: true }, true)).rejects.toThrow('untrusted sender')
    expect(setEnabled).toHaveBeenCalledOnce()
  })
})
