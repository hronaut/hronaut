import { afterEach, describe, expect, it, vi } from 'vitest'
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Array<{ label?: string; accelerator?: string; click?: () => void }> }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Hronaut had no keys for Back and Forward: Alt+Left and Alt+Right, or Cmd+[ and Cmd+] on macOS, did nothing.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewItems(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const tabs = { back: vi.fn(), forward: vi.fn() }
  const actions: string[] = []
  createApplicationMenu({
    text: (key) => key, showWindow: vi.fn(), mainWindow: () => null, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (action, callback) => { actions.push(action); callback() },
    tabs: () => tabs as never
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  const item = (label: string) => view.find((candidate) => candidate.label === label)!
  return { tabs, actions, back: item('native.menu.back'), forward: item('native.menu.forward') }
}

describe('Back and Forward in the View menu', () => {
  it('have Chrome\'s keys on each platform', () => {
    for (const on of ['linux', 'win32'] as const) {
      const { back, forward } = viewItems(on)
      expect([back.accelerator, forward.accelerator]).toEqual(['Alt+Left', 'Alt+Right'])
    }
    const { back, forward } = viewItems('darwin')
    expect([back.accelerator, forward.accelerator]).toEqual(['Cmd+[', 'Cmd+]'])
  })

  it('go back and forward in the shown tab', () => {
    const { tabs, actions, back, forward } = viewItems('linux')
    back.click!()
    expect(tabs.back).toHaveBeenCalledWith()
    forward.click!()
    expect(tabs.forward).toHaveBeenCalledWith()
    expect(actions).toEqual(['go back', 'go forward'])
  })
})
