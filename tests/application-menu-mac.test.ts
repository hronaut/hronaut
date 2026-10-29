import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; role?: string; accelerator?: string; submenu?: Item[]; click?: () => void }
const installed = vi.hoisted(() => ({ template: [] as Item[] }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: Item[]) => template, setApplicationMenu: (menu: Item[]) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// On macOS Hronaut's menu had none of an application's own items there: Cmd+H, Cmd+Option+H, Cmd+M and Cmd+, did
// nothing, and there was no About in the Hronaut menu, no Services or Show All and no Window menu, as Chrome and every
// other Mac app has.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menuOn(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const send = vi.fn()
  const showWindow = vi.fn()
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => ({ id: 1, webContents: { send, isDestroyed: () => false } }) as never,
    checkForUpdates: vi.fn(), requestQuit: vi.fn(), runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), runPageNextPane: vi.fn(),
    tabs: () => null
  }).installApplicationMenu()
  const named = (item: Item): string => item.type === 'separator' ? '-' : item.role ? `${item.role}:${item.label}` : item.label ?? ''
  return { send, showWindow, template: installed.template, named }
}

describe('the application menu on macOS', () => {
  it('has the application\'s own items, as Chrome there, with the system\'s keys for hiding', () => {
    const { template, named } = menuOn('darwin')
    expect(template[0]!.submenu!.map(named)).toEqual([
      'native.menu.about', '-', 'native.menu.settings', '-',
      'native.menu.show', 'native.menu.checkUpdates', '-',
      'services:native.menu.services', '-',
      'hide:native.menu.hide', 'hideOthers:native.menu.hideOthers', 'unhide:native.menu.showAll', '-',
      'native.menu.quit'
    ])
    const settings = template[0]!.submenu!.find((item) => item.label === 'native.menu.settings')!
    expect(settings.accelerator).toBe('Cmd+,')
    // Hide, Hide Others, Minimize and the rest take their keys from their roles.
    expect(template.flatMap((menu) => menu.submenu ?? []).filter((item) => item.role && item.accelerator)).toEqual([])
  })

  it('has a Window menu before Help, and Help is the system\'s, which adds its search of the menus', () => {
    const { template, named } = menuOn('darwin')
    const labels = template.map((menu) => menu.label)
    const windowMenu = template[labels.indexOf('native.menu.window')]!
    expect(windowMenu.role).toBe('window')
    expect(windowMenu.submenu!.map(named)).toEqual([
      'minimize:native.menu.minimize', 'zoom:native.menu.zoom', '-', 'front:native.menu.bringAllToFront'
    ])
    expect(labels.indexOf('native.menu.window')).toBe(labels.indexOf('native.menu.help') - 1)
    const help = template.find((menu) => menu.label === 'native.menu.help')!
    expect(help.role).toBe('help')
    // About is in the Hronaut menu there, as in Chrome.
    expect(help.submenu!.map((item) => item.label)).not.toContain('native.menu.about')
  })

  it('shows the window and opens Settings or About when chosen', () => {
    const { template, send, showWindow } = menuOn('darwin')
    const item = (label: string) => template[0]!.submenu!.find((entry) => entry.label === label)!
    item('native.menu.settings').click!()
    item('native.menu.about').click!()
    expect(showWindow).toHaveBeenCalledTimes(2)
    expect(send.mock.calls).toEqual([['help:open', 'settings'], ['help:open', 'about']])
  })

  it('leaves the menu on Linux and Windows as it was', () => {
    for (const on of ['linux', 'win32'] as const) {
      const { template, named } = menuOn(on)
      expect(template[0]!.submenu!.map(named)).toEqual(['native.menu.show', 'native.menu.checkUpdates', '-', 'native.menu.quit'])
      expect(template.map((menu) => menu.label)).not.toContain('native.menu.window')
      const help = template.find((menu) => menu.label === 'native.menu.help')!
      expect(help.role).toBeUndefined()
      expect(help.submenu!.map((item) => item.label)).toContain('native.menu.about')
    }
  })
})
