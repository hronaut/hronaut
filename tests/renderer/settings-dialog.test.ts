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
      setSearchEngine: vi.fn(async (searchEngine: AppSettings['searchEngine']) => (settings.value = { ...settings.value, searchEngine })),
      addSiteSearch: vi.fn(),
      updateSiteSearch: vi.fn(),
      removeSiteSearch: vi.fn(),
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
        dataWorkspaces: [],
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
    const dialog = await screen.findByRole('tabpanel', { name: 'Settings' })
    expect(dialog.querySelector('.settings-footer')).toBeNull()
    expect(dialog.querySelector('#settings-title')).toBeNull()
    expect(screen.getByRole('searchbox').closest('.settings-header')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to default' }).closest('.settings-header')).not.toBeNull()
    await vi.waitFor(() => expect(dialog).toHaveFocus())
    expect(screen.getByRole('button', { name: /Search engine/ })).toHaveAttribute('aria-current', 'page')

    const reset = screen.getByRole('button', { name: 'Reset to default' })
    await userEvent.setup().click(reset)
    expect(reset).toBeDisabled()
    expect(screen.getByRole('searchbox')).toBeDisabled()
    expect(dialog.querySelector('.settings-layout')).toHaveAttribute('inert')
    expect(dialog.querySelector('.settings-layout')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeEnabled()
    await userEvent.setup().click(reset)
    expect(resetSection).toHaveBeenCalledOnce()
    expect(resetSection).toHaveBeenCalledWith('search')
    resetting.resolve(true)
    await vi.waitFor(() => expect(reset).toBeEnabled())
    expect(dialog.querySelector('.settings-layout')).not.toHaveAttribute('inert')

    await userEvent.setup().click(screen.getByTestId('search-engine-bing'))
    await userEvent.setup().click(dialog.parentElement!)
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('search-engine-bing')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /Search engine/ })).toHaveAttribute('aria-current', 'page')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('tabpanel', { name: 'Settings' })).not.toBeInTheDocument()
    expect(controller.tabOpen.value).toBe(false)
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
      addSiteSearch: vi.fn(),
      updateSiteSearch: vi.fn(),
      removeSiteSearch: vi.fn(),
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
        dataWorkspaces: [],
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

describe('SettingsDialog focus after Reset to default', () => {
  // JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  function renderDialog(resetSection: () => Promise<boolean>) {
    const controller = useSettingsDialogController({
      beforeOpen: vi.fn(), resetSection, isResetDisabled: () => false, onResetError: vi.fn()
    })
    const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
    const searchController = useSearchSettingsController({
      settings, setSearchEngine: vi.fn(async () => settings.value), addSiteSearch: vi.fn(), updateSiteSearch: vi.fn(), removeSiteSearch: vi.fn(), onError: vi.fn()
    })
    const inactiveController = {} as never
    const view = render(SettingsDialog, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        controller, searchController, downloadController: inactiveController, performanceController: inactiveController,
        mcpController: inactiveController, privacyController: inactiveController, permissionsController: inactiveController,
        credentialsController: inactiveController, updateController: inactiveController,
        releaseHistoryController: inactiveController, supportController: inactiveController,
        walletsController: inactiveController, workspaces: [], dataWorkspaces: [], formatBytes: String,
        formatNumber: String, formatDateTime: String, testSound: vi.fn(), reportSettingError: vi.fn(),
        openUrl: vi.fn(async () => undefined), purchaseCommercialLicense: vi.fn()
      }
    })
    return { controller, searchController, view }
  }

  // Reset to default disabled itself and the whole section while it ran, Chromium moved its focus to the document body,
  // and nothing gave it back: after resetting a section with the keyboard, the next Tab started at the top of the window.
  it('gives the focus back to Reset to default once the reset finishes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const resetting = deferred<boolean>()
    const { controller, searchController, view } = renderDialog(() => resetting.promise)
    try {
      controller.openSection('search')
      const reset = await screen.findByRole('button', { name: 'Reset to default' })
      await userEvent.setup().click(reset)
      expect(reset).toBeDisabled()
      dropFocusLikeChromium(reset)
      resetting.resolve(true)
      await vi.waitFor(() => expect(reset).toBeEnabled())
      await vi.waitFor(() => expect(reset).toHaveFocus())
    } finally {
      view.unmount()
      vi.restoreAllMocks()
      searchController.dispose()
      controller.dispose()
    }
  })

  it('leaves newer focus alone when the reset finishes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const resetting = deferred<boolean>()
    const { controller, searchController, view } = renderDialog(() => resetting.promise)
    try {
      controller.openSection('search')
      const reset = await screen.findByRole('button', { name: 'Reset to default' })
      await userEvent.setup().click(reset)
      dropFocusLikeChromium(reset)
      const close = screen.getByRole('button', { name: 'Close settings' })
      close.focus()
      resetting.resolve(true)
      await vi.waitFor(() => expect(reset).toBeEnabled())
      expect(close).toHaveFocus()
    } finally {
      view.unmount()
      vi.restoreAllMocks()
      searchController.dispose()
      controller.dispose()
    }
  })
})
