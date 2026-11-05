import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: Partial<Electron.KeyboardEvent>) => void }
type Contents = { on: (name: string, listener: (event: unknown, input: Partial<Electron.Input>) => void) => void }
const installed = vi.hoisted(() => ({
  template: [] as Array<{ label?: string; submenu?: Item[] }>,
  created: [] as Array<(event: unknown, contents: Contents) => void>
}))
vi.mock('electron', () => ({
  app: { on: (_name: string, listener: (event: unknown, contents: Contents) => void) => { installed.created.push(listener) } },
  Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } }
}))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The menu runs these with the browser; they run on the fake browser's stubs.
vi.mock('../src/main/browser/page-source/page-source.js', () => ({
  viewShownPageSource: (browser: { viewShownPageSource: () => unknown }) => browser.viewShownPageSource()
}))
vi.mock('../src/main/browser/page-save/page-save.js', () => ({ saveShownPage: (browser: { saveShownPage: () => unknown }) => browser.saveShownPage() }))
vi.mock('../src/main/browser/page-print/page-print.js', () => ({ printShownPage: (browser: { printShownPage: () => unknown }) => browser.printShownPage() }))

// A held Ctrl+J opened and closed Downloads with every repeat its page or Hronaut's window left alone, so it ended open
// or closed by chance, and a held Shift+Esc did the same to the Task manager. Chrome runs a command that is not
// repeatable once for a held key.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

// A click of an item's key, which Electron reports with the modifiers the key holds.
function byKey(item: Item): Partial<Electron.KeyboardEvent> {
  const modifiers = item.accelerator!.split('+').slice(0, -1)
  return {
    triggeredByAccelerator: true,
    ctrlKey: modifiers.includes('Ctrl') || modifiers.includes('CmdOrCtrl'),
    shiftKey: modifiers.includes('Shift'),
    altKey: modifiers.includes('Alt'),
    metaKey: modifiers.includes('Cmd')
  }
}

function viewMenu(on: NodeJS.Platform = 'linux') {
  Object.defineProperty(process, 'platform', { value: on })
  const runShortcut = vi.fn()
  const showWindow = vi.fn()
  const tabs = { viewShownPageSource: vi.fn(), saveShownPage: vi.fn(), printShownPage: vi.fn() }
  const mainWindow = { id: 1, webContents: { isFocused: () => false } }
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (_action, callback) => { callback() }, runShortcut, runPageNextPane: vi.fn(), tabs: () => tabs as never
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  const item = (label: string) => view.find((candidate) => candidate.label === label)!
  // Every web contents of Hronaut's, as its window and a page, whose keys the menu counts.
  const inputs: Array<(event: unknown, input: Partial<Electron.Input>) => void> = []
  const contents = () => {
    installed.created.at(-1)!({}, { on: (_name, listener) => { inputs.push(listener) } })
    const index = inputs.length - 1
    return (input: Partial<Electron.Input>) => inputs[index]!({}, input)
  }
  return { runShortcut, showWindow, tabs, mainWindow, item, contents }
}

describe('a held key of the View menu', () => {
  it('opens or closes Downloads and the Task manager, and bookmarks all tabs, once for each press', () => {
    const { runShortcut, mainWindow, item, contents } = viewMenu()
    const page = contents()
    for (const label of ['native.menu.downloads', 'native.menu.taskManager', 'native.menu.bookmarkAllTabs']) {
      const held = item(label)
      // A press and two repeats, a released key, then the next press and a repeat.
      for (const input of [
        { type: 'keyDown', isAutoRepeat: false }, { type: 'keyDown', isAutoRepeat: true }, { type: 'keyDown', isAutoRepeat: true },
        { type: 'keyUp', isAutoRepeat: false }, { type: 'rawKeyDown', isAutoRepeat: false }, { type: 'keyDown', isAutoRepeat: true }
      ]) {
        page(input)
        if (input.type !== 'keyUp') held.click!(held, mainWindow, byKey(held))
      }
    }
    expect(runShortcut.mock.calls).toEqual([
      ['downloads'], ['downloads'], ['task-manager'], ['task-manager'], ['bookmark-all-tabs'], ['bookmark-all-tabs']
    ])
  })

  it('views the source, saves and prints the page once for each press', () => {
    const { tabs, mainWindow, item, contents } = viewMenu()
    const page = contents()
    for (const label of ['native.menu.viewSource', 'native.menu.savePage', 'native.menu.print']) {
      const held = item(label)
      for (const isAutoRepeat of [false, true, true, false]) {
        page({ type: 'keyDown', isAutoRepeat })
        held.click!(held, mainWindow, byKey(held))
      }
    }
    expect(tabs.viewShownPageSource).toHaveBeenCalledTimes(2)
    expect(tabs.saveShownPage).toHaveBeenCalledTimes(2)
    expect(tabs.printShownPage).toHaveBeenCalledTimes(2)
  })

  it('counts the presses in every web contents, so the next press in another one acts', () => {
    // Ctrl+J in a page, then in Hronaut's window: the window's press opened the panel the page's press had closed.
    const { runShortcut, mainWindow, item, contents } = viewMenu()
    const page = contents()
    const shell = contents()
    const downloads = item('native.menu.downloads')
    page({ type: 'keyDown', isAutoRepeat: false })
    downloads.click!(downloads, mainWindow, byKey(downloads))
    shell({ type: 'keyDown', isAutoRepeat: false })
    downloads.click!(downloads, mainWindow, byKey(downloads))
    expect(runShortcut.mock.calls).toEqual([['downloads'], ['downloads']])
  })

  it('acts each time it is chosen from the menu', () => {
    const { runShortcut, tabs, item } = viewMenu()
    for (const label of ['native.menu.downloads', 'native.menu.viewSource']) {
      const chosen = item(label)
      chosen.click!(chosen, undefined, {})
      chosen.click!(chosen, undefined, {})
    }
    expect(runShortcut.mock.calls).toEqual([['downloads'], ['downloads']])
    expect(tabs.viewShownPageSource).toHaveBeenCalledTimes(2)
  })

  // Electron reports an item chosen with the keyboard, after Alt elsewhere than macOS, or with Ctrl+F2 or VoiceOver on
  // macOS, as triggered by an accelerator, but without the modifiers its key holds, and no web contents counts the keys
  // that chose it. Taken for its key, a second choice did nothing, and one in a panel in its own window did nothing at all.
  it('acts each time it is chosen with the keyboard, in any window, showing the main window', () => {
    const { runShortcut, showWindow, tabs, mainWindow, item, contents } = viewMenu()
    contents()({ type: 'keyDown', isAutoRepeat: false })
    for (const label of [
      'native.menu.downloads', 'native.menu.taskManager', 'native.menu.bookmarkAllTabs', 'native.menu.viewSource', 'native.menu.savePage', 'native.menu.print'
    ]) {
      const chosen = item(label)
      chosen.click!(chosen, mainWindow, { triggeredByAccelerator: true })
      chosen.click!(chosen, { id: 2 }, { triggeredByAccelerator: true })
    }
    expect(runShortcut.mock.calls).toEqual([
      ['downloads'], ['downloads'], ['task-manager'], ['task-manager'], ['bookmark-all-tabs'], ['bookmark-all-tabs']
    ])
    expect(tabs.viewShownPageSource).toHaveBeenCalledTimes(2)
    expect(tabs.saveShownPage).toHaveBeenCalledTimes(2)
    expect(tabs.printShownPage).toHaveBeenCalledTimes(2)
    expect(showWindow).toHaveBeenCalledTimes(12)
  })

  // VoiceOver's own keys hold Control and Option, which may still be down when it chooses an item.
  it('takes a click without Cmd for a choice on macOS, whatever other modifiers it holds', () => {
    const { runShortcut, tabs, mainWindow, item } = viewMenu('darwin')
    for (const label of ['native.menu.downloads', 'native.menu.viewSource']) {
      const chosen = item(label)
      chosen.click!(chosen, mainWindow, { triggeredByAccelerator: true, ctrlKey: true, altKey: true })
      chosen.click!(chosen, mainWindow, { triggeredByAccelerator: true, ctrlKey: true, altKey: true })
    }
    expect(runShortcut.mock.calls).toEqual([['downloads'], ['downloads']])
    expect(tabs.viewShownPageSource).toHaveBeenCalledTimes(2)
  })

  // A key the person set for an item in System Settings, such as F7 for Downloads, reaches it without its own key's Cmd.
  it('takes the key the person set for an item on macOS for its key', () => {
    const { runShortcut, mainWindow, item, contents } = viewMenu('darwin')
    const page = contents()
    const downloads = Object.assign(item('native.menu.downloads'), { userAccelerator: 'F7' })
    for (const isAutoRepeat of [false, true, true]) {
      page({ type: 'keyDown', isAutoRepeat })
      downloads.click!(downloads, mainWindow, { triggeredByAccelerator: true })
    }
    expect(runShortcut.mock.calls).toEqual([['downloads']])
  })

  it('acts for each key typed where no window of Hronaut\'s has focus, which no web contents counts', () => {
    // A key typed in detached DevTools, or on macOS with every window closed, reaches the menu with no window.
    const { runShortcut, mainWindow, item, contents } = viewMenu()
    const page = contents()
    const downloads = item('native.menu.downloads')
    page({ type: 'keyDown', isAutoRepeat: false })
    downloads.click!(downloads, mainWindow, byKey(downloads))
    downloads.click!(downloads, undefined, byKey(downloads))
    downloads.click!(downloads, undefined, byKey(downloads))
    expect(runShortcut.mock.calls).toEqual([['downloads'], ['downloads'], ['downloads']])
  })

  it('uses up no press with a key it ignores, typed in a panel in its own window', () => {
    const { tabs, mainWindow, item, contents } = viewMenu()
    const panel = contents()
    const source = item('native.menu.viewSource')
    panel({ type: 'keyDown', isAutoRepeat: false })
    source.click!(source, { id: 2 }, byKey(source))
    expect(tabs.viewShownPageSource).not.toHaveBeenCalled()
    source.click!(source, mainWindow, byKey(source))
    expect(tabs.viewShownPageSource).toHaveBeenCalledOnce()
  })
})
