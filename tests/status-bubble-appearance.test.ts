import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const nativeTheme = vi.hoisted(() => ({ value: null as unknown as EventEmitter & { themeSource: string; shouldUseDarkColors: boolean } }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  nativeTheme.value = Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false })
  return { nativeTheme: nativeTheme.value }
})
const { createWindowAppearance } = await import('../src/main/windows/appearance.js')

// The status bubble draws in the theme's colors and at the shell's scale; it followed neither a theme chosen while it
// showed, nor the system's appearance changing under the System theme.

it('lays the status bubble out again for a new theme, interface scale or system appearance', () => {
  const settings = { theme: 'system' as 'system' | 'dark' }
  const statusBubble = { layoutChanged: vi.fn() }
  const appearance = createWindowAppearance({
    mainWindowRefs: { window: null },
    panelWindowRefs: { window: null },
    settings: () => settings,
    applyMainWindowBackground: vi.fn(),
    applyMainWindowTitleBarOverlay: vi.fn(),
    addressSuggestionOverlay: { setZoomFactor: vi.fn() },
    toastOverlay: { relayout: vi.fn() },
    sidebarOverlay: { relayout: vi.fn() },
    statusBubble,
    sendToShellWindows: vi.fn(),
    currentRendererSettingsState: () => ({}) as never
  })
  appearance.applyTheme('cyberpunk')
  expect(statusBubble.layoutChanged).toHaveBeenCalledTimes(1)
  appearance.applyInterfaceScale(1.25 as never)
  expect(statusBubble.layoutChanged).toHaveBeenCalledTimes(2)
  appearance.followSystemTheme()
  nativeTheme.value.shouldUseDarkColors = true
  nativeTheme.value.emit('updated')
  expect(statusBubble.layoutChanged).toHaveBeenCalledTimes(3)
  // A theme of its own does not change with the system's.
  settings.theme = 'dark'
  nativeTheme.value.emit('updated')
  expect(statusBubble.layoutChanged).toHaveBeenCalledTimes(3)
})
