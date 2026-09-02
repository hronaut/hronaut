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
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
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
        releaseHistoryController: inactiveController,
        supportController: inactiveController,
        walletsController: inactiveController,
        workspaces: [],
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
    expect(dialog.querySelector('.settings-layout')).toHaveAttribute('inert')
    expect(dialog.querySelector('.settings-layout')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeEnabled()
    await userEvent.setup().click(reset)
    expect(resetSection).toHaveBeenCalledOnce()
    expect(resetSection).toHaveBeenCalledWith('search')
    resetting.resolve(true)
    await vi.waitFor(() => expect(reset).toBeEnabled())
    expect(dialog.querySelector('.settings-layout')).not.toHaveAttribute('inert')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
    searchController.dispose()
    controller.dispose()
  })

  it('routes a vertical mouse wheel through the responsive horizontal section rail', async () => {
    const controller = useSettingsDialogController({
      beforeOpen: vi.fn(),
      resetSection: vi.fn(async () => true),
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
        releaseHistoryController: inactiveController,
        supportController: inactiveController,
        walletsController: inactiveController,
        workspaces: [],
        formatBytes: String,
        formatNumber: String,
        formatDateTime: String,
        testSound: vi.fn(),
        reportSettingError: vi.fn(),
        openUrl: vi.fn(async () => undefined),
        purchaseCommercialLicense: vi.fn()
      }
    })

    controller.openSection('appearance')
    const navigation = await screen.findByRole('navigation', { name: 'Settings sections' })
    Object.defineProperties(navigation, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, writable: true, value: 0 }
    })
    const wheel = new WheelEvent('wheel', { deltaY: 180, cancelable: true })
    navigation.dispatchEvent(wheel)

    expect(navigation.scrollLeft).toBe(180)
    expect(wheel.defaultPrevented).toBe(true)

    const horizontalTrackpad = new WheelEvent('wheel', { deltaX: 200, deltaY: 20, cancelable: true })
    navigation.dispatchEvent(horizontalTrackpad)
    expect(navigation.scrollLeft).toBe(180)
    expect(horizontalTrackpad.defaultPrevented).toBe(false)

    const zoomWheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: 120, cancelable: true })
    navigation.dispatchEvent(zoomWheel)
    expect(navigation.scrollLeft).toBe(180)
    expect(zoomWheel.defaultPrevented).toBe(false)

    navigation.scrollLeft = 660
    const endBoundary = new WheelEvent('wheel', { deltaY: 120, cancelable: true })
    navigation.dispatchEvent(endBoundary)
    expect(navigation.scrollLeft).toBe(660)
    expect(endBoundary.defaultPrevented).toBe(false)

    navigation.scrollLeft = 0
    const startBoundary = new WheelEvent('wheel', { deltaY: -120, cancelable: true })
    navigation.dispatchEvent(startBoundary)
    expect(navigation.scrollLeft).toBe(0)
    expect(startBoundary.defaultPrevented).toBe(false)

    controller.close()
    searchController.dispose()
    controller.dispose()
  })
})
