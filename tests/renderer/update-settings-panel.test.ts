import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import UpdateSettingsPanel from '../../src/renderer/src/components/UpdateSettingsPanel.vue'
import { useUpdateSettingsController } from '../../src/renderer/src/composables/useUpdateSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, AppUpdateState, HronautUpdatesApi } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function renderPanel() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const check = vi.fn(async (): Promise<AppUpdateState> => ({ status: 'up-to-date', currentVersion: '1.7.1' }))
  const api: HronautUpdatesApi = {
    getState: vi.fn(async (): Promise<AppUpdateState> => ({ status: 'idle', currentVersion: '1.7.1' })),
    check,
    download: vi.fn(async (): Promise<AppUpdateState> => ({ status: 'downloaded', currentVersion: '1.7.1' })),
    install: vi.fn(async () => true),
    onChanged: vi.fn(() => () => undefined),
    onOpenRequested: vi.fn(() => () => undefined)
  }
  const setCheckOnStartup = vi.fn(async (enabled: boolean) => {
    settings.value = { ...settings.value, checkForUpdatesOnStartup: enabled }
    return settings.value
  })
  const controller = useUpdateSettingsController({
    api,
    settings,
    setCheckOnStartup,
    onCheckStarted: vi.fn(),
    onStateAccepted: vi.fn(),
    onSettingError: vi.fn(),
    onActionError: vi.fn()
  })
  controller.accept({ status: 'disabled', currentVersion: '1.7.1', message: 'Updates unavailable in this build.' })
  render(UpdateSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { check, controller, setCheckOnStartup, settings }
}

describe('UpdateSettingsPanel', () => {
  it('renders the current version, update status, and startup preference', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'Software updates' })).toBeVisible()
    expect(screen.getByText('1.7.1')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Software update status' })).toHaveTextContent('Updates unavailable')
    expect(screen.getByRole('checkbox', { name: /^Check for updates on startup/ })).toBeChecked()
    controller.dispose()
  })

  it('disables every panel action while a check is pending', async () => {
    const checking = deferred<AppUpdateState>()
    const { check, controller } = renderPanel()
    check.mockImplementationOnce(() => checking.promise)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Check now' }))

    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /^Check for updates on startup/ })).toBeDisabled()
    checking.resolve({ status: 'up-to-date', currentVersion: '1.7.1' })
    await vi.waitFor(() => expect(controller.busy.value).toBe(false))
    controller.dispose()
  })

  it('restores the startup checkbox after a persistence failure', async () => {
    const { controller, setCheckOnStartup } = renderPanel()
    setCheckOnStartup.mockRejectedValueOnce(new Error('disk full'))
    const user = userEvent.setup()
    const startup = screen.getByRole('checkbox', { name: /^Check for updates on startup/ })

    await user.click(startup)

    expect(startup).toBeChecked()
    controller.dispose()
  })
})
