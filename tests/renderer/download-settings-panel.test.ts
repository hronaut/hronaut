import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DownloadSettingsPanel from '../../src/renderer/src/components/DownloadSettingsPanel.vue'
import { useDownloadSettingsController } from '../../src/renderer/src/composables/useDownloadSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, DownloadDirectorySelection } from '../../src/shared/types.js'
import { getByTooltip } from './helpers/tooltip.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function renderPanel() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const api = {
    chooseDownloadDirectory: vi.fn(async (): Promise<DownloadDirectorySelection> => ({
      canceled: false,
      settings: { ...settings.value, downloadDirectory: '/tmp/chosen' }
    })),
    setAskWhereToSaveDownloads: vi.fn(async (enabled: boolean) => ({
      ...settings.value,
      askWhereToSaveDownloads: enabled
    })),
    resetDownloads: vi.fn(async () => settings.value),
    openDownloadDirectory: vi.fn(async () => undefined)
  }
  const controller = useDownloadSettingsController({
    api,
    settings,
    defaultDirectory: ref('/home/test/Downloads'),
    applySettings: (next) => { settings.value = next },
    translate: (key) => key
  })
  render(DownloadSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { api, controller, settings }
}

describe('DownloadSettingsPanel', () => {
  it('renders the effective directory and disables every control while choosing a folder', async () => {
    const selection = deferred<DownloadDirectorySelection>()
    const { api, controller, settings } = renderPanel()
    const user = userEvent.setup()
    api.chooseDownloadDirectory.mockImplementationOnce(() => selection.promise)

    expect(getByTooltip('/home/test/Downloads')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Change/ }))

    expect(screen.getByRole('button', { name: /^Change/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /^Ask where to save each file/ })).toBeDisabled()

    selection.resolve({
      canceled: false,
      settings: { ...settings.value, downloadDirectory: '/tmp/chosen' }
    })
    await vi.waitFor(() => getByTooltip('/tmp/chosen'))
    controller.dispose()
  })

  it('restores the checkbox when saving the preference fails', async () => {
    const { api, controller } = renderPanel()
    const user = userEvent.setup()
    api.setAskWhereToSaveDownloads.mockRejectedValueOnce(new Error('cannot save'))
    const checkbox = screen.getByRole('checkbox', { name: /^Ask where to save each file/ })

    await user.click(checkbox)

    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('cannot save')).toBeVisible()
    controller.dispose()
  })
})

describe('DownloadSettingsPanel focus after a change', () => {
  // JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  // Every download control was disabled while one change saved, so Chromium moved the focus of the one you used to the
  // document body and nothing gave it back: Space on the switch saved the preference and the next Tab started outside
  // Settings.
  it.each([
    ['checkbox', /^Ask where to save each file/, 'setAskWhereToSaveDownloads'],
    ['button', /^Open folder/, 'openDownloadDirectory'],
    ['button', /^Change/, 'chooseDownloadDirectory']
  ] as const)('gives the focus back to the %s %s once its change settles', async (role, name, method) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { api, controller, settings } = renderPanel()
    const pending = deferred<never>()
    api[method].mockImplementationOnce(() => pending.promise)
    try {
      const control = screen.getByRole(role, { name })
      await userEvent.setup().click(control)
      expect(control).toBeDisabled()
      dropFocusLikeChromium(control)
      pending.resolve((method === 'openDownloadDirectory' ? undefined
        : method === 'chooseDownloadDirectory' ? { canceled: true, settings: settings.value }
          : { ...settings.value, askWhereToSaveDownloads: true }) as never)
      await vi.waitFor(() => expect(control).toBeEnabled())
      await vi.waitFor(() => expect(control).toHaveFocus())
    } finally {
      vi.restoreAllMocks()
      controller.dispose()
    }
  })

  it('does not take the focus while Hronaut is in the background', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { api, controller, settings } = renderPanel()
    const pending = deferred<AppSettings>()
    api.setAskWhereToSaveDownloads.mockImplementationOnce(() => pending.promise)
    try {
      const control = screen.getByRole('checkbox', { name: /^Ask where to save each file/ })
      await userEvent.setup().click(control)
      dropFocusLikeChromium(control)
      pending.resolve({ ...settings.value, askWhereToSaveDownloads: true })
      await vi.waitFor(() => expect(control).toBeEnabled())
      expect(document.body).toHaveFocus()
    } finally {
      vi.restoreAllMocks()
      controller.dispose()
    }
  })
})
