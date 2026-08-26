import { describe, expect, it, vi } from 'vitest'
import { useShellFeedbackController } from '../../src/renderer/src/composables/useShellFeedbackController.js'

function createController() {
  const copyText = vi.fn(async (_text: string) => undefined)
  const showToast = vi.fn()
  const controller = useShellFeedbackController({
    browser: { copyText },
    translate: (key) => `translated:${key}`,
    showToast
  })
  return { controller, copyText, showToast }
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
})
