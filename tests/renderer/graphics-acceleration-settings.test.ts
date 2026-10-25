import { createTestingPinia } from '@pinia/testing'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GraphicsAccelerationSettings from '../../src/renderer/src/components/GraphicsAccelerationSettings.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
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
  Object.defineProperty(window, 'hronautSettings', {
    configurable: true,
    value: { setGraphicsAcceleration, graphicsAccelerationInUse }
  })
  const pinia = createTestingPinia({
    stubActions: false,
    createSpy: vi.fn,
    initialState: { settings: { settings, systemTheme: 'light', systemLocale: 'en-US', resolvedLocale: 'en-US' } }
  })
  const view = render(GraphicsAccelerationSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
  const region = screen.getByRole('region', { name: 'Graphics' })
  const use = within(region).getByRole('checkbox', { name: /Use graphics acceleration when available/ })
  return { ...view, region, use, setGraphicsAcceleration, graphicsAccelerationInUse, user: userEvent.setup() }
}

describe('Graphics acceleration settings', () => {
  it('is on by default, and asks for a restart only while the saved choice differs from this run', async () => {
    const { region, use, user, setGraphicsAcceleration, graphicsAccelerationInUse } = renderSettings()
    expect(use).toBeChecked()
    expect(within(region).getByText(/parts of a window stay black or blank/)).toBeVisible()
    await vi.waitFor(() => expect(graphicsAccelerationInUse).toHaveBeenCalledOnce())
    expect(within(region).queryByRole('status')).toBeNull()
    await user.click(use)
    expect(setGraphicsAcceleration).toHaveBeenLastCalledWith(false)
    expect(use).not.toBeChecked()
    expect(within(region).getByRole('status')).toHaveTextContent(RESTART)
    await user.click(use)
    expect(setGraphicsAcceleration).toHaveBeenLastCalledWith(true)
    expect(within(region).queryByRole('status')).toBeNull()
  })

  it('shows a run started with it off, and asks for a restart once it is turned back on', async () => {
    const { region, use, user, graphicsAccelerationInUse } = renderSettings({ graphicsAcceleration: false }, Promise.resolve(false))
    expect(use).not.toBeChecked()
    await vi.waitFor(() => expect(graphicsAccelerationInUse).toHaveBeenCalledOnce())
    expect(within(region).queryByRole('status')).toBeNull()
    await user.click(use)
    expect(use).toBeChecked()
    await vi.waitFor(() => expect(within(region).getByRole('status')).toHaveTextContent(RESTART))
  })

  it('shows the saved choice again when a change fails, and asks for no restart while this run is unknown', async () => {
    const view = renderSettings({}, Promise.reject(new Error('main is gone')))
    const { region, use, user, setGraphicsAcceleration } = view
    await vi.waitFor(() => expect(view.emitted().settingError).toHaveLength(1))
    setGraphicsAcceleration.mockRejectedValueOnce(new Error('disk full'))
    await user.click(use)
    await vi.waitFor(() => expect(use).toBeChecked())
    expect(view.emitted().settingError).toHaveLength(2)
    expect(within(region).queryByRole('status')).toBeNull()
    await user.click(use)
    expect(use).not.toBeChecked()
    expect(within(region).queryByRole('status')).toBeNull()
  })
})
