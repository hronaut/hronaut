import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; accelerator?: string; visible?: boolean; click?: (item: unknown, window: unknown, event: Partial<Electron.KeyboardEvent>) => void }
type Contents = { on: (name: string, listener: (event: unknown, input: Partial<Electron.Input>) => void) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }>, created: [] as Array<(event: unknown, contents: Contents) => void> }))
vi.mock('electron', () => ({ app: { on: (_name: string, listener: (event: unknown, contents: Contents) => void) => { installed.created.push(listener) } }, Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The menu stops loading with the browser; that runs on the fake browser's stub. Reloads are recorded.
const navigation = vi.hoisted(() => ({ reloads: [] as string[] }))
vi.mock('../src/main/browser/page-navigation/page-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-navigation/page-navigation.js')>(),
  reload: () => { navigation.reloads.push('reload') },
  reloadIgnoringCache: () => { navigation.reloads.push('reload-ignoring-cache') },
  stopFocusedPageLoading: (browser: { stopFocusedPageLoading: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.stopFocusedPageLoading(...args)
}))

// F5, Shift+F5, Ctrl+F5 and Alt+D did nothing, where Chrome reloads or goes to the address bar once the website in
// focus leaves the key alone.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const runShortcut = vi.fn()
  const runPageNextPane = vi.fn()
  const stopFocusedPageLoading = vi.fn()
  const browser = { stopFocusedPageLoading }
  // A page in the main window has the keyboard, rather than Hronaut's own window.
  const shellFocused = { value: false }
  const mainWindow = { id: 1, webContents: { isFocused: () => shellFocused.value } }
  createApplicationMenu({
    text: (key) => key, showWindow: vi.fn(), mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (_action, callback) => { callback() }, runShortcut, runPageNextPane,
    tabs: () => browser as never
  }).installApplicationMenu()
  const view = installed.template.find((candidate) => candidate.label === 'native.menu.view')!.submenu!
  const key = (accelerator: string) => view.find((item) => item.accelerator === accelerator)
  // A page's web contents, whose keys the menu counts.
  let pageInput: ((event: unknown, input: Partial<Electron.Input>) => void) | undefined
  installed.created.at(-1)!({}, { on: (_name, listener) => { pageInput = listener } })
  const pressKey = (repeat = false) => pageInput!({}, { type: 'keyDown', isAutoRepeat: repeat })
  return { runShortcut, runPageNextPane, stopFocusedPageLoading, shellFocused, mainWindow, view, key, pressKey }
}

describe('Chrome\'s keys a website may keep', () => {
  it('are hidden keys of the View menu elsewhere than macOS, running the browser\'s shortcut', () => {
    const { runShortcut, mainWindow, key } = menu('linux')
    for (const [accelerator, action] of [
      ['F5', 'reload'], ['Shift+F5', 'reload-ignoring-cache'], ['Ctrl+F5', 'reload-ignoring-cache'], ['Alt+D', 'focus-address'],
      ['Ctrl+E', 'focus-address'], ['Alt+Home', 'open-home'],
      ['F3', 'find-next'], ['Shift+F3', 'find-previous'],
      ['Ctrl+Shift+PageDown', 'move-tab-next'], ['Ctrl+Shift+PageUp', 'move-tab-previous'],
      ['CmdOrCtrl+D', 'bookmark'], ['Ctrl+H', 'visit-history'],
      ['Ctrl+1', 'select-tab-1'], ['Ctrl+8', 'select-tab-8'], ['Ctrl+9', 'select-last-tab'],
      ['Ctrl+num1', 'select-tab-1'], ['Ctrl+num8', 'select-tab-8'], ['Ctrl+num9', 'select-last-tab'],
      ['Ctrl+Shift+-', 'zoom-out'],
      ['CmdOrCtrl+F', 'find'], ['CmdOrCtrl+L', 'focus-address'], ['CmdOrCtrl+=', 'zoom-in'],
      ['Ctrl+numadd', 'zoom-in'], ['Ctrl+numsub', 'zoom-out'], ['Ctrl+num0', 'zoom-reset']
    ] as const) {
      const item = key(accelerator)!
      expect(item.visible, accelerator).toBe(false)
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
    }
    expect(menu('win32').key('F5')).toBeDefined()
    expect(menu('darwin').key('F5')).toBeUndefined()
    expect(menu('darwin').key('Alt+D')).toBeUndefined()
    expect(menu('darwin').key('Ctrl+E')).toBeUndefined()
    expect(menu('darwin').key('Alt+Home')).toBeUndefined()
    expect(menu('darwin').key('F3')).toBeUndefined()
    expect(menu('darwin').key('Ctrl+1')).toBeUndefined()
    expect(menu('darwin').key('F6')).toBeUndefined()
    expect(menu('darwin').key('Ctrl+Shift+-')).toBeUndefined()
  })

  // Ctrl+Shift+Page Down did nothing on macOS, where Chrome moves the tab with it once the website leaves it alone. A
  // design tool's Cmd+D and a document's Cmd+Y never reached their page, which Chrome lets keep them, nor did Cmd+F,
  // Cmd+L, or Cmd with = in a design tool that zooms its canvas with it.
  it('are only the keys that move the tab and those with Cmd on macOS, as Chrome has there', () => {
    const { runShortcut, mainWindow, key, view } = menu('darwin')
    const keys = [
      ['Ctrl+Shift+PageDown', 'move-tab-next'], ['Ctrl+Shift+PageUp', 'move-tab-previous'], ['CmdOrCtrl+D', 'bookmark'], ['Cmd+Y', 'visit-history'],
      ['CmdOrCtrl+F', 'find'], ['CmdOrCtrl+L', 'focus-address'], ['CmdOrCtrl+=', 'zoom-in']
    ] as const
    for (const [accelerator, action] of keys) {
      const item = key(accelerator)!
      expect(item.visible, accelerator).toBe(false)
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
    }
    expect(view.filter((item) => item.visible === false).map((item) => item.accelerator)).toEqual(keys.map(([accelerator]) => accelerator))
  })

  // A held Ctrl+D on a page that left it alone added, removed and added the bookmark again, and a held Ctrl+H opened and
  // closed History, where Chrome acts on the first press only.
  it.each(['linux', 'darwin'] as const)('bookmark the page and open history once for a held key on %s', (system) => {
    const { runShortcut, mainWindow, key, pressKey } = menu(system)
    for (const accelerator of ['CmdOrCtrl+D', system === 'darwin' ? 'Cmd+Y' : 'Ctrl+H']) {
      const item = key(accelerator)!
      // A press and its repeats, then the next press and a repeat.
      for (const repeat of [false, true, true, false, true]) {
        pressKey(repeat)
        item.click!(item, mainWindow, { triggeredByAccelerator: true })
      }
    }
    expect(runShortcut.mock.calls).toEqual([['bookmark'], ['bookmark'], ['visit-history'], ['visit-history']])
  })

  // A held Ctrl+F or Ctrl+L on a page that left it alone acted on each repeat, where Chrome finds or goes to the address
  // bar once, as it moves the tab, goes to the next pane and finds the next match for each repeat.
  it('find and go to the address bar once for a held key, and repeat moving the tab, the next pane and the next match', () => {
    const { runShortcut, runPageNextPane, mainWindow, key, pressKey } = menu('linux')
    const hold = (accelerator: string) => {
      const item = key(accelerator)!
      for (const repeat of [false, true, true]) {
        pressKey(repeat)
        item.click!(item, mainWindow, { triggeredByAccelerator: true })
      }
    }
    for (const accelerator of ['CmdOrCtrl+F', 'CmdOrCtrl+L', 'Ctrl+Shift+PageDown', 'F3', 'F6']) hold(accelerator)
    expect(runShortcut.mock.calls).toEqual([['find'], ['focus-address'], ['move-tab-next'], ['move-tab-next'], ['move-tab-next'], ['find-next'], ['find-next'], ['find-next']])
    expect(runPageNextPane).toHaveBeenCalledTimes(3)
  })

  it('go to the pane after the page with F6 and Shift+F6', () => {
    const { runShortcut, runPageNextPane, mainWindow, key } = menu('linux')
    for (const accelerator of ['F6', 'Shift+F6']) {
      const item = key(accelerator)!
      expect(item.visible, accelerator).toBe(false)
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
    }
    expect(runPageNextPane).toHaveBeenCalledTimes(2)
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('stop the page in focus loading with Escape, in main rather than in Hronaut\'s window', () => {
    // Escape did nothing on a loading page, where Chrome stops it once the page leaves the key alone.
    const { runShortcut, stopFocusedPageLoading, mainWindow, key } = menu('linux')
    const item = key('Escape')!
    expect(item.visible).toBe(false)
    item.click!(item, mainWindow, { triggeredByAccelerator: true })
    expect(stopFocusedPageLoading).toHaveBeenCalledOnce()
    expect(runShortcut).not.toHaveBeenCalled()
    // Typed in a panel in its own window, it would stop no page there.
    item.click!(item, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
    expect(stopFocusedPageLoading).toHaveBeenCalledOnce()
    expect(menu('win32').key('Escape')).toBeDefined()
    expect(menu('darwin').key('Escape')).toBeUndefined()
  })

  it('do nothing for a key Hronaut\'s own window left alone, as under one of its dialogs', () => {
    // Hronaut's window runs these keys itself; F6 under its dialog moved the keyboard out of the dialog to the address bar.
    const { runShortcut, runPageNextPane, stopFocusedPageLoading, shellFocused, mainWindow, key } = menu('linux')
    shellFocused.value = true
    for (const accelerator of ['F5', 'Escape', 'Alt+D', 'Ctrl+E', 'Alt+Home', 'F6', 'F3', 'Ctrl+Shift+PageDown']) {
      const item = key(accelerator)!
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
    }
    expect(runShortcut).not.toHaveBeenCalled()
    expect(runPageNextPane).not.toHaveBeenCalled()
    expect(stopFocusedPageLoading).not.toHaveBeenCalled()
  })

  it('act only as keys of the main window', () => {
    const { runShortcut, key } = menu('linux')
    const item = key('F5')!
    // Typed in a panel in its own window, the key would reload a page out of view.
    item.click!(item, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
    item.click!(item, undefined, { triggeredByAccelerator: true })
    item.click!(item, { id: 1, webContents: {} }, { triggeredByAccelerator: false })
    expect(runShortcut).not.toHaveBeenCalled()
  })

  // A website's own Ctrl+R, as a web editor opens recent folders with it, never reached it: Hronaut reloaded the page.
  it('reload, and without the cache, once for each press of Reload\'s key the page leaves alone, from the main window only', () => {
    const { runShortcut, shellFocused, mainWindow, view, pressKey } = menu('linux')
    const reloads: string[] = []
    for (const [accelerator, label] of [['CmdOrCtrl+R', 'native.menu.reload'], ['CmdOrCtrl+Shift+R', 'native.menu.reloadWithoutCache']] as const) {
      const item = view.find((candidate) => candidate.accelerator === accelerator && candidate.visible !== false)!
      expect(item.label).toBe(label)
      const before = navigation.reloads.length
      const key = { triggeredByAccelerator: true, ctrlKey: true, shiftKey: accelerator.includes('Shift') }
      for (const repeat of [false, true, true, false]) {
        pressKey(repeat)
        item.click!(item, mainWindow, key)
      }
      // Typed in a panel in its own window, in Hronaut's window, or where no window of Hronaut's has focus.
      pressKey()
      item.click!(item, { id: 2, webContents: {} }, key)
      item.click!(item, undefined, key)
      shellFocused.value = true
      item.click!(item, mainWindow, key)
      // Chosen from the menu with the mouse or, after Alt, with the keyboard, it reloads each time, wherever the keyboard is.
      item.click!(item, mainWindow, { triggeredByAccelerator: false })
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
      shellFocused.value = false
      reloads.push(`${label} ${navigation.reloads.length - before}`)
    }
    expect(reloads).toEqual(['native.menu.reload 5', 'native.menu.reloadWithoutCache 5'])
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('leave the menu as it shows', () => {
    const { view } = menu('linux')
    const shown = view.filter((item) => item.visible !== false).map((item) => item.label)
    expect(shown).not.toContain('runtime.shortcuts.address')
    expect(shown.filter((label) => label === 'native.menu.reload')).toHaveLength(1)
  })
})
