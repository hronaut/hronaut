import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DownloadSettingsPanel from '../../src/renderer/src/components/DownloadSettingsPanel.vue'
import { useDownloadSettingsController } from '../../src/renderer/src/composables/useDownloadSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, DownloadDirectorySelection } from '../../src/shared/types.js'

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

    expect(screen.getByTitle('/home/test/Downloads')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Change/ }))

    expect(screen.getByRole('button', { name: /^Change/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /^Ask where to save each file/ })).toBeDisabled()

    selection.resolve({
      canceled: false,
      settings: { ...settings.value, downloadDirectory: '/tmp/chosen' }
    })
    await screen.findByTitle('/tmp/chosen')
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
