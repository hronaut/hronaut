import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; role?: string; accelerator?: string; visible?: boolean; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Ctrl/Cmd+G, Ctrl/Cmd+Shift+G, F3 and Shift+F3 did nothing, where Chrome goes to the next or previous match of Find.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const runShortcut = vi.fn()
  const showWindow = vi.fn()
  const mainWindow = { id: 1, webContents: {} }
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut, runPageNextPane: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  const edit = installed.template.find((candidate) => candidate.label === 'native.menu.edit')!.submenu!
  const item = (label: string) => edit.find((candidate) => candidate.label === label)!
  return { runShortcut, showWindow, mainWindow, edit, item }
}

describe('Find Next and Find Previous', () => {
  it.each(['linux', 'win32', 'darwin'] as const)('end the Edit menu with Chrome\'s keys on %s', (on) => {
    const { edit, item } = menu(on)
    expect(edit.slice(-4).map((entry) => entry.role ?? entry.type ?? entry.label)).toEqual(['selectAll', 'separator', 'native.menu.findNext', 'native.menu.findPrevious'])
    expect(item('native.menu.findNext').accelerator).toBe('CmdOrCtrl+G')
    expect(item('native.menu.findPrevious').accelerator).toBe('CmdOrCtrl+Shift+G')
    expect(item('native.menu.findNext').visible).not.toBe(false)
  })

  it('go to the next and previous match when chosen, from any window, showing the main window', () => {
    const { runShortcut, showWindow, item } = menu('linux')
    item('native.menu.findNext').click!({}, { id: 2, webContents: {} }, { triggeredByAccelerator: false })
    expect(runShortcut).toHaveBeenLastCalledWith('find-next')
    item('native.menu.findPrevious').click!({}, undefined, { triggeredByAccelerator: false })
    expect(runShortcut).toHaveBeenLastCalledWith('find-previous')
    expect(showWindow).toHaveBeenCalledTimes(2)
  })

  it('act on their keys only from the main window', () => {
    const { runShortcut, showWindow, mainWindow, item } = menu('darwin')
    const next = item('native.menu.findNext')
    // Typed in a panel in its own window, the key would search a page out of view.
    next.click!(next, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
    next.click!(next, undefined, { triggeredByAccelerator: true })
    expect(runShortcut).not.toHaveBeenCalled()
    next.click!(next, mainWindow, { triggeredByAccelerator: true })
    expect(runShortcut).toHaveBeenCalledWith('find-next')
    expect(showWindow).not.toHaveBeenCalled()
  })
})
