import { createTestingPinia } from '@pinia/testing'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GraphicsAccelerationSettings from '../../src/renderer/src/features/settings/GraphicsAccelerationSettings.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS, useSettingsStore } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'

// Settings had no way to stop drawing with the graphics card. As in Chrome's Use graphics acceleration when available,
// a switch saves the choice, and Settings says a restart applies it while this run still uses the other one.

const RESTART = 'Restart Hronaut to apply this change.'

function renderSettings(saved: Partial<AppSettings> = {}, inUse: Promise<boolean> = Promise.resolve(true)) {
  let settings: AppSettings = { ...DEFAULT_RENDERER_SETTINGS, ...saved }
  const setGraphicsAcceleration = vi.fn(async (graphicsAcceleration: boolean) => {
    settings = { ...settings, graphicsAcceleration }
    return settings
  })
  const graphicsAccelerationInUse = vi.fn(() => inUse)
  const restart = vi.fn(async () => true)
  Object.defineProperty(window, 'hronautSettings', {
    configurable: true,
    value: { setGraphicsAcceleration, graphicsAccelerationInUse, restart }
  })
  const pinia = createTestingPinia({
    stubActions: false,
    createSpy: vi.fn,
    initialState: { settings: { settings, systemTheme: 'light', systemLocale: 'en-US', resolvedLocale: 'en-US' } }
  })
  const view = render(GraphicsAccelerationSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
  const region = screen.getByRole('region', { name: 'Graphics' })
  const use = within(region).getByRole('checkbox', { name: /Use graphics acceleration when available/ })
  // The live region stays in place, so a notice that a change brings is announced.
  const notice = () => within(region).getByRole('status').textContent.trim()
  const restartButton = () => within(region).queryByRole('button', { name: 'Restart' })
  return { ...view, region, use, notice, restartButton, restart, setGraphicsAcceleration, graphicsAccelerationInUse, user: userEvent.setup() }
}

describe('Graphics acceleration settings', () => {
  it('is on by default, and asks for a restart only while the saved choice differs from this run', async () => {
    const { region, use, notice, restartButton, user, setGraphicsAcceleration, graphicsAccelerationInUse } = renderSettings()
    expect(use).toBeChecked()
    expect(within(region).getByText(/parts of a window stay black or blank/)).toBeVisible()
    await vi.waitFor(() => expect(graphicsAccelerationInUse).toHaveBeenCalledOnce())
    expect(notice()).toBe('')
    expect(restartButton()).toBeNull()
    await user.click(use)
    expect(setGraphicsAcceleration).toHaveBeenLastCalledWith(false)
    expect(use).not.toBeChecked()
    expect(notice()).toBe(RESTART)
    expect(restartButton()).toBeVisible()
    expect(restartButton()).toHaveAccessibleDescription(RESTART)
    await user.click(use)
    expect(setGraphicsAcceleration).toHaveBeenLastCalledWith(true)
    expect(notice()).toBe('')
    expect(restartButton()).toBeNull()
  })

  // Settings only said to restart Hronaut, and closing its window may just hide it in the tray; as Chrome's Relaunch,
  // Restart beside the notice restarts it, after main asks about downloads in progress.
  it('restarts Hronaut from beside the notice, which stays while Hronaut stays open', async () => {
    const { use, notice, restartButton, restart, user } = renderSettings()
    await user.click(use)
    await user.click(restartButton()!)
    expect(restart).toHaveBeenCalledOnce()
    restart.mockResolvedValueOnce(false)
    await user.click(restartButton()!)
    expect(restart).toHaveBeenCalledTimes(2)
    restart.mockRejectedValueOnce(new Error('main is gone'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await user.click(restartButton()!)
      await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce())
    } finally {
      logged.mockRestore()
    }
    expect(notice()).toBe(RESTART)
    expect(restartButton()).toBeEnabled()
  })

  it('asks for no restart once Reset to default for Performance puts back what this run uses', async () => {
    const { use, notice } = renderSettings({ graphicsAcceleration: false }, Promise.resolve(true))
    await vi.waitFor(() => expect(notice()).toBe(RESTART))
    const store = useSettingsStore()
    store.$patch({ settings: { ...store.settings, graphicsAcceleration: true } })
    await vi.waitFor(() => expect(notice()).toBe(''))
    expect(use).toBeChecked()
  })

  it('shows a run started with it off, and asks for a restart once it is turned back on', async () => {
    const { use, notice, user, graphicsAccelerationInUse } = renderSettings({ graphicsAcceleration: false }, Promise.resolve(false))
    expect(use).not.toBeChecked()
    await vi.waitFor(() => expect(graphicsAccelerationInUse).toHaveBeenCalledOnce())
    expect(notice()).toBe('')
    await user.click(use)
    expect(use).toBeChecked()
    await vi.waitFor(() => expect(notice()).toBe(RESTART))
  })

  // Reading this run's choice saves nothing, so its failure showed Setting not saved, again each time Performance opened.
  it('shows the saved choice again when a change fails, and asks for no restart while this run is unknown', async () => {
    const view = renderSettings({}, Promise.reject(new Error('main is gone')))
    const { use, notice, user, setGraphicsAcceleration, graphicsAccelerationInUse } = view
    await vi.waitFor(() => expect(graphicsAccelerationInUse).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(view.emitted().settingError).toBeUndefined()
    setGraphicsAcceleration.mockRejectedValueOnce(new Error('disk full'))
    await user.click(use)
    await vi.waitFor(() => expect(use).toBeChecked())
    expect(view.emitted().settingError).toHaveLength(1)
    expect(notice()).toBe('')
    await user.click(use)
    expect(use).not.toBeChecked()
    expect(notice()).toBe('')
  })
})
