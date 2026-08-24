import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from '../../src/renderer/src/components/SettingsDialog.vue'
import { useSearchSettingsController } from '../../src/renderer/src/composables/useSearchSettingsController.js'
import { useSettingsDialogController } from '../../src/renderer/src/composables/useSettingsDialogController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

describe('SettingsDialog', () => {
  it('focuses the selected section, serializes reset interaction, and closes accessibly', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const resetting = deferred<boolean>()
    const resetSection = vi.fn(() => resetting.promise)
    const controller = useSettingsDialogController({
      beforeOpen: vi.fn(),
      resetSection,
      isResetDisabled: () => false,
      onResetError: vi.fn()
    })
    const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
    const searchController = useSearchSettingsController({
      settings,
      setSearchEngine: vi.fn(async () => settings.value),
      onError: vi.fn()
    })
    const inactiveController = {} as never
    render(SettingsDialog, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        controller,
        searchController,
        downloadController: inactiveController,
        performanceController: inactiveController,
        mcpController: inactiveController,
        privacyController: inactiveController,
        permissionsController: inactiveController,
        credentialsController: inactiveController,
        updateController: inactiveController,
        supportController: inactiveController,
        formatBytes: String,
        formatNumber: String,
        formatDateTime: String,
        testSound: vi.fn(),
        reportSettingError: vi.fn(),
        openUrl: vi.fn(async () => undefined),
        purchaseCommercialLicense: vi.fn()
      }
    })

    controller.openSection('search')
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    await vi.waitFor(() => expect(dialog).toHaveFocus())
    expect(screen.getByRole('button', { name: /Search engine/ })).toHaveAttribute('aria-current', 'page')

    const reset = screen.getByRole('button', { name: 'Reset to default' })
    await userEvent.setup().click(reset)
    expect(reset).toBeDisabled()
    await userEvent.setup().click(reset)
    expect(resetSection).toHaveBeenCalledOnce()
    expect(resetSection).toHaveBeenCalledWith('search')
    resetting.resolve(true)
    await vi.waitFor(() => expect(reset).toBeEnabled())

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
    searchController.dispose()
    controller.dispose()
  })
})
