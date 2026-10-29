import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { quit: vi.fn() } }))
vi.mock('electron', () => electron)

import { WorkspaceMetadataError } from '../src/main/browser/tab-store.js'
import { createTabRuntimeStartup, type TabRuntimeState } from '../src/main/tab-runtime-startup.js'
import { translate } from '../src/shared/i18n.js'

function startup(options: { window?: () => Promise<void>; dialog?: () => Promise<Electron.MessageBoxReturnValue> } = {}) {
  const state: TabRuntimeState = { tabs: null, initialization: null, initializedTabs: null, startupFailure: undefined }
  const showStartupNotice = vi.fn(options.window ?? (async () => undefined))
  const showMessageBox = vi.fn(options.dialog ?? (async () => ({ response: 0, checkboxChecked: false })))
  const runtime = createTabRuntimeStartup({
    state,
    text: (key, parameters) => translate('de-DE', key, parameters),
    showStartupNotice,
    showMessageBox,
    reportBrowserActionFailure: vi.fn()
  })
  return { state, runtime, showStartupNotice, showMessageBox }
}

const notice = {
  title: translate('de-DE', 'native.dialog.workspaceRecoveryTitle'),
  message: translate('de-DE', 'native.dialog.workspaceRecoveryMessage'),
  detail: translate('de-DE', 'native.dialog.workspaceRecoveryDetail'),
  quit: translate('de-DE', 'native.menu.quit')
}

afterEach(() => {
  vi.restoreAllMocks()
  electron.app.quit.mockReset()
})

describe('workspace recovery notice', () => {
  it('tells the person in Hronaut\'s own window, in the interface language, and quits once it closes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let close!: () => void
    const { state, runtime, showStartupNotice, showMessageBox } = startup({ window: () => new Promise<void>((resolve) => { close = resolve }) })
    const error = new WorkspaceMetadataError('invalid-json')
    const shown = runtime.showWorkspaceRecoveryNotice(error)
    expect(state.startupFailure).toBe(error)
    expect(showStartupNotice).toHaveBeenCalledExactlyOnceWith(notice)
    await Promise.resolve()
    expect(electron.app.quit).not.toHaveBeenCalled()

    close()
    await shown
    expect(electron.app.quit).toHaveBeenCalledOnce()
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('falls back to the system dialog with the same notice when its window cannot show it, then quits', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { runtime, showMessageBox } = startup({ window: async () => { throw new Error('synthetic /private/profile/tabs.json failure') } })
    await runtime.showWorkspaceRecoveryNotice(new WorkspaceMetadataError('invalid-json'))
    expect(showMessageBox).toHaveBeenCalledExactlyOnceWith({
      type: 'error', title: notice.title, message: notice.message, detail: notice.detail,
      buttons: [notice.quit], defaultId: 0, cancelId: 0, noLink: true
    })
    expect(electron.app.quit).toHaveBeenCalledOnce()
    // Neither the failure's text nor a path reaches the log.
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private')
  })

  it('still quits when neither the window nor the system dialog can show the notice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { runtime } = startup({
      window: async () => { throw new Error('synthetic window failure') },
      dialog: async () => { throw new Error('synthetic dialog failure') }
    })
    await runtime.showWorkspaceRecoveryNotice(new WorkspaceMetadataError('invalid-json'))
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })
})

describe('startup failure notice', () => {
  const failed = {
    title: translate('de-DE', 'native.dialog.startupFailedTitle'),
    message: translate('de-DE', 'native.dialog.startupFailedMessage'),
    detail: translate('de-DE', 'native.dialog.startupFailedDetail'),
    quit: translate('de-DE', 'native.menu.quit')
  }

  it('says in Hronaut\'s own window, in the interface language, that Hronaut could not start, and quits once it closes', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let close!: () => void
    const { state, runtime, showStartupNotice, showMessageBox } = startup({ window: () => new Promise<void>((resolve) => { close = resolve }) })
    const error = new Error('EACCES: /private/profile/settings.json')
    const shown = runtime.showStartupFailureNotice(error)
    expect(showStartupNotice).toHaveBeenCalledExactlyOnceWith(failed)
    // The notice names no file; the log keeps the error for whoever investigates.
    expect(JSON.stringify(showStartupNotice.mock.calls)).not.toContain('private')
    expect(logged).toHaveBeenCalledWith('[startup] Hronaut could not start:', error)
    // Unlike rejected workspace metadata, nothing stops the browser's actions for good.
    expect(state.startupFailure).toBeUndefined()
    await Promise.resolve()
    expect(electron.app.quit).not.toHaveBeenCalled()

    close()
    await shown
    expect(electron.app.quit).toHaveBeenCalledOnce()
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('falls back to the system dialog, and quits even when that cannot show either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { runtime, showMessageBox } = startup({
      window: async () => { throw new Error('synthetic window failure') },
      dialog: async () => { throw new Error('synthetic dialog failure') }
    })
    await runtime.showStartupFailureNotice(new Error('synthetic startup failure'))
    expect(showMessageBox).toHaveBeenCalledExactlyOnceWith({
      type: 'error', title: failed.title, message: failed.message, detail: failed.detail,
      buttons: [failed.quit], defaultId: 0, cancelId: 0, noLink: true
    })
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })
})
