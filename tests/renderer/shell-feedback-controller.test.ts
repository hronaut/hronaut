import { describe, expect, it, vi } from 'vitest'
import { useShellFeedbackController } from '../../src/renderer/src/composables/useShellFeedbackController.js'

function createController() {
  const copyText = vi.fn(async (_text: string): Promise<void> => undefined)
  const showToast = vi.fn()
  const translate = vi.fn((key: string) => `translated:${key}`)
  const controller = useShellFeedbackController({
    browser: { copyText },
    translate,
    showToast
  })
  return { controller, copyText, showToast, translate }
}

describe('shell feedback controller', () => {
  it.each([true, false])('gates only caller-owned failure presentation when allowed=%s', async allowed => {
    const { controller, copyText, showToast } = createController()
    copyText.mockRejectedValueOnce(new Error('Guarded clipboard refusal'))
    await expect(controller.copyText('guarded', () => allowed)).resolves.toBe(false)
    expect(copyText).toHaveBeenCalledExactlyOnceWith('guarded')
    expect(showToast).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it('checks failure ownership when a pending native write rejects', async () => {
    const { controller, copyText, showToast } = createController()
    let reject!: (reason: Error) => void
    copyText.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail }))
    let current = true
    const copying = controller.copyText('pending', () => current)
    current = false
    reject(new Error('Late refusal'))
    await expect(copying).resolves.toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('does not cancel clipboard writes when failure presentation is no longer owned', async () => {
    const { controller, copyText, showToast } = createController()
    await expect(controller.copyText('still dispatched', () => false)).resolves.toBe(true)
    expect(copyText).toHaveBeenCalledExactlyOnceWith('still dispatched')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('reports browser actions and startup failures with normalized fallbacks', () => {
    const { controller, showToast } = createController()

    controller.reportActionError(new Error("Error invoking remote method 'browser:reload': Error: Renderer disappeared"))
    controller.reportStartupFailure([])

    expect(showToast).toHaveBeenNthCalledWith(
      1,
      'error',
      'translated:runtimeDetails.browserAction',
      'Renderer disappeared'
    )
    expect(showToast).toHaveBeenNthCalledWith(
      2,
      'error',
      'translated:runtime.toast.startupIncomplete',
      'translated:runtime.toast.startupIncompleteDescription'
    )
  })

  it('copies text and reports clipboard failures without throwing into the shell', async () => {
    const { controller, copyText, showToast } = createController()

    await expect(controller.copyText('ready')).resolves.toBe(true)
    copyText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await expect(controller.copyText('blocked')).resolves.toBe(false)

    expect(copyText).toHaveBeenNthCalledWith(1, 'ready')
    expect(copyText).toHaveBeenNthCalledWith(2, 'blocked')
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'translated:runtime.capture.copyFailed',
      'Clipboard unavailable'
    )
  })

  it('keeps authored search errors and setting failures in one shell boundary', () => {
    const { controller, showToast } = createController()

    controller.reportSearchError('Could not search tabs', 'Try again')
    controller.reportSettingError({})

    expect(showToast).toHaveBeenNthCalledWith(1, 'error', 'Could not search tabs', 'Try again')
    expect(showToast).toHaveBeenNthCalledWith(
      2,
      'error',
      'translated:runtime.toast.settingNotSaved',
      'translated:runtime.toast.settingKept'
    )
  })

  it('owns split-view, workspace, shortcut, and clipboard failure presentation', () => {
    const { controller, showToast, translate } = createController()
    const workspace = { id: 'workspace-1', name: 'QA workspace' } as never

    controller.reportSplitViewError({}, 'Could not open split view')
    controller.reportWorkspaceError(workspace, {})
    controller.reportShortcutError('reload', {})
    controller.reportClipboardFailure('Clipboard unavailable')

    expect(translate).toHaveBeenCalledWith(
      'runtime.workspace.newTabDescription',
      { workspace: 'QA workspace' }
    )
    expect(showToast).toHaveBeenNthCalledWith(
      1,
      'error',
      'translated:runtime.workspace.splitFailed',
      'Could not open split view'
    )
    expect(showToast).toHaveBeenNthCalledWith(
      2,
      'error',
      'translated:runtime.workspace.newTabFailed',
      'translated:runtime.workspace.newTabDescription'
    )
    expect(showToast).toHaveBeenNthCalledWith(
      3,
      'error',
      'translated:runtimeDetails.browserAction',
      'translated:runtime.toast.actionFailed'
    )
    expect(showToast).toHaveBeenNthCalledWith(
      4,
      'error',
      'translated:runtime.capture.copyFailed',
      'Clipboard unavailable'
    )
  })

  it.each([
    ['reload', 'runtimeActions.actionFailure.reload'],
    ['save link', 'runtimeActions.actionFailure.saveLink'],
    ['open context menu', 'runtimeActions.actionFailure.generic']
  ] as const)('selects the %s browser action failure title', (action, titleKey) => {
    const { controller, showToast } = createController()

    controller.reportBrowserActionFailure({ action, message: 'Renderer unavailable' })

    expect(showToast).toHaveBeenCalledWith(
      'error',
      `translated:${titleKey}`,
      'Renderer unavailable'
    )
  })
})
