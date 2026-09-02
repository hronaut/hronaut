import { describe, expect, it, vi } from 'vitest'
import { useShellFeedbackController } from '../../src/renderer/src/composables/useShellFeedbackController.js'

function createController() {
  const copyText = vi.fn(async (_text: string) => undefined)
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
