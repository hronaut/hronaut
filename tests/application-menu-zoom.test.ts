import { afterEach, describe, expect, it, vi } from 'vitest'
type MenuEvent = { triggeredByAccelerator?: boolean; ctrlKey?: boolean; metaKey?: boolean }
type Item = { label?: string; type?: string; role?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: MenuEvent) => void }
type Contents = { on: (name: string, listener: (event: unknown, input: Partial<Electron.Input>) => void) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }>, created: [] as Array<(event: unknown, contents: Contents) => void> }))
vi.mock('electron', () => ({ app: { on: (_name: string, listener: (event: unknown, contents: Contents) => void) => { installed.created.push(listener) } }, Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The View menu's Actual Size, Zoom In and Zoom Out zoomed the page in view straight in main, Hronaut Home and a page
// under Settings too, which their keys leave alone.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const runShortcut = vi.fn()
  const runNativeBrowserAction = vi.fn()
  const showWindow = vi.fn()
  // A page in the main window has the keyboard, rather than Hronaut's own window.
  const shellFocused = { value: false }
  const mainWindow = { id: 1, webContents: { isFocused: () => shellFocused.value } }
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction, runShortcut, runPageNextPane: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  const view = installed.template.find((candidate) => candidate.label === 'native.menu.view')!.submenu!
  const item = (label: string) => view.find((candidate) => candidate.label === label)!
  // A page's web contents, whose keys the menu counts.
  let pageInput: ((event: unknown, input: Partial<Electron.Input>) => void) | undefined
  installed.created.at(-1)!({}, { on: (_name, listener) => { pageInput = listener } })
  const pressKey = (repeat = false) => pageInput!({}, { type: 'keyDown', isAutoRepeat: repeat })
  return { runShortcut, runNativeBrowserAction, showWindow, shellFocused, mainWindow, item, pressKey }
}

const ZOOM_ITEMS = [['native.menu.actualSize', 'CmdOrCtrl+0', 'zoom-reset'], ['native.menu.zoomIn', 'CmdOrCtrl+Plus', 'zoom-in'], ['native.menu.zoomOut', 'CmdOrCtrl+-', 'zoom-out']] as const

describe('the View menu\'s zoom', () => {
  it.each(['linux', 'win32', 'darwin'] as const)('zooms as its keys do in Hronaut\'s window when chosen, showing the main window first, on %s', (on) => {
    const { runShortcut, runNativeBrowserAction, showWindow, item } = menu(on)
    for (const [label, accelerator, action] of ZOOM_ITEMS) {
      expect(item(label).accelerator).toBe(accelerator)
      item(label).click!({}, { id: 2, webContents: {} }, { triggeredByAccelerator: false })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
      expect(showWindow.mock.invocationCallOrder.at(-1)).toBeLessThan(runShortcut.mock.invocationCallOrder.at(-1)!)
    }
    expect(showWindow).toHaveBeenCalledTimes(3)
    // Not straight on the tab: Hronaut's window leaves Home and a page under Settings at their zoom.
    expect(runNativeBrowserAction).not.toHaveBeenCalled()
  })

  // A held Ctrl+= zoomed the page on each repeat that reached the menu, where Chrome zooms once for a held key, and a
  // website that zooms its own canvas with Ctrl/Cmd with = and - lost the keys before it saw them.
  it.each(['linux', 'darwin'] as const)('zooms once for each press of its key the website leaves alone, without raising the main window, on %s', (on) => {
    const { runShortcut, showWindow, mainWindow, item, pressKey } = menu(on)
    const key = on === 'darwin' ? { metaKey: true } : { ctrlKey: true }
    for (const [label, , action] of ZOOM_ITEMS) {
      const zoom = item(label)
      // A press and its repeats, then the next press and a repeat.
      for (const repeat of [false, true, true, false, true]) {
        pressKey(repeat)
        zoom.click!(zoom, mainWindow, { triggeredByAccelerator: true, ...key })
      }
      expect(runShortcut.mock.calls.filter(([called]) => called === action)).toHaveLength(2)
    }
    expect(runShortcut).toHaveBeenCalledTimes(6)
    expect(showWindow).not.toHaveBeenCalled()
  })

  it('leaves its keys alone in a panel in its own window and in Hronaut\'s window, which zoom with the first press themselves', () => {
    const { runShortcut, shellFocused, mainWindow, item, pressKey } = menu('linux')
    for (const [label] of ZOOM_ITEMS) {
      const zoom = item(label)
      pressKey()
      zoom.click!(zoom, { id: 2, webContents: {} }, { triggeredByAccelerator: true, ctrlKey: true })
      zoom.click!(zoom, undefined, { triggeredByAccelerator: true, ctrlKey: true })
      shellFocused.value = true
      zoom.click!(zoom, mainWindow, { triggeredByAccelerator: true, ctrlKey: true })
      shellFocused.value = false
    }
    expect(runShortcut).not.toHaveBeenCalled()
  })

  // Chosen with the keyboard after Alt, Electron reports the item as triggered by an accelerator, without the Ctrl its key
  // holds; it zooms each time, wherever the keyboard was, showing the main window first as when chosen with the mouse.
  it('zooms each time it is chosen from the menu with the keyboard, showing the main window first', () => {
    const { runShortcut, showWindow, shellFocused, mainWindow, item } = menu('linux')
    shellFocused.value = true
    for (const [label, , action] of ZOOM_ITEMS) {
      const zoom = item(label)
      zoom.click!(zoom, mainWindow, { triggeredByAccelerator: true })
      zoom.click!(zoom, mainWindow, { triggeredByAccelerator: true })
      expect(runShortcut.mock.calls.filter(([called]) => called === action)).toHaveLength(2)
    }
    expect(showWindow).toHaveBeenCalledTimes(6)
  })
})
