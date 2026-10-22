import { Menu, type BaseWindow, type BrowserWindow, type KeyboardEvent, type MenuItemConstructorOptions } from 'electron'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { AppUpdateState, HelpMenuAction } from '../../shared/types.js'

interface ApplicationMenuHost {
  /** Translates into the current interface language; read on every build because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  showWindow(): void
  /** The main window; read on every use because it is created after the menu and goes when it closes. */
  mainWindow(): Pick<BrowserWindow, 'webContents' | 'id'> | null
  checkForUpdates(): Promise<AppUpdateState>
  /** Quits, after asking first when downloads are in progress; the menu's Quit uses it. */
  requestQuit(): void
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  runNativeBrowserAction(action: string, callback: () => unknown): void
  /** Runs a browser shortcut as a key the page in focus left alone does, in the shell or on its tab. */
  runShortcut(action: BrowserShortcutAction): void
  tabs(): Pick<BrowserTabsManager, 'newTab' | 'back' | 'forward' | 'historyGesture' | 'reload' | 'reloadIgnoringCache' | 'printShownPage' | 'toggleDevTools' | 'setZoom'> | null
}

/**
 * The native application menu. `installApplicationMenu` builds it again in the current language. Dependencies stay
 * lazy because the menu is installed before the window exists.
 */
export function createApplicationMenu(host: ApplicationMenuHost): { installApplicationMenu(): void } {
  function requestHelp(action: HelpMenuAction): void {
    host.showWindow()
    if (host.mainWindow() && !host.mainWindow()!.webContents.isDestroyed()) host.mainWindow()!.webContents.send('help:open', action)
  }

  function openRepository(): void {
    host.showWindow()
    host.runNativeBrowserAction(
      'open GitHub repository',
      () => host.tabs()?.newTab({ url: 'https://github.com/hronaut/hronaut', active: true })
    )
  }

  // Choosing Back or Forward goes like the toolbar's arrow. Their keys go by the rules of the person's own input on the
  // shown tab, and only from the main window: typed in a panel in its own window, they would change a page out of view.
  function goInHistory(direction: 'back' | 'forward', window: BaseWindow | undefined, event: KeyboardEvent): void {
    if (!event.triggeredByAccelerator) {
      host.runNativeBrowserAction(`go ${direction}`, () => direction === 'back' ? host.tabs()?.back() : host.tabs()?.forward())
    } else if (window !== undefined && window.id === host.mainWindow()?.id) {
      host.runNativeBrowserAction(`go ${direction}`, () => host.tabs()?.historyGesture(direction))
    }
  }

  // Chrome's keys a website may keep (websiteKeptShortcutAction). As keys of the menu they reach it only when the
  // website or field in focus leaves them alone, and never from an agent; typed in a panel in its own window, they
  // would act on a page out of view. Hidden, because Reload and the address bar already show their main keys.
  function websiteKeptKeys(): MenuItemConstructorOptions[] {
    if (process.platform === 'darwin') return []
    const item = (label: string, accelerator: string, action: BrowserShortcutAction): MenuItemConstructorOptions => ({
      label,
      accelerator,
      visible: false,
      click: (_item, window, event) => {
        if (event.triggeredByAccelerator && window !== undefined && window.id === host.mainWindow()?.id) host.runShortcut(action)
      }
    })
    return [
      item(host.text('native.menu.reload'), 'F5', 'reload'),
      item(host.text('native.menu.reloadWithoutCache'), 'Shift+F5', 'reload-ignoring-cache'),
      item(host.text('native.menu.reloadWithoutCache'), 'Ctrl+F5', 'reload-ignoring-cache'),
      item(host.text('runtime.shortcuts.address'), 'Alt+D', 'focus-address')
    ]
  }

  function installApplicationMenu(): void {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Hronaut',
          submenu: [
            { label: host.text('native.menu.show'), accelerator: 'CmdOrCtrl+Shift+H', click: host.showWindow },
            {
              label: host.text('native.menu.checkUpdates'),
              click: () => {
                host.showWindow()
                host.mainWindow()?.webContents.send('updates:open')
                void host.checkForUpdates()
              }
            },
            { type: 'separator' },
            {
              label: host.text('native.menu.quit'),
              accelerator: 'CmdOrCtrl+Q',
              click: host.requestQuit
            }
          ]
        },
        {
          label: host.text('native.menu.edit'),
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label: host.text('native.menu.view'),
          submenu: [
            {
              label: host.text('native.menu.commandPalette'),
              accelerator: 'CmdOrCtrl+Shift+P',
              click: () => {
                host.showWindow()
                host.mainWindow()?.webContents.send('browser:shortcut-requested', 'command-palette')
              }
            },
            {
              label: host.text('native.menu.pickElement'),
              accelerator: process.platform === 'darwin' ? 'Cmd+Alt+C' : 'Ctrl+Shift+C',
              click: () => {
                host.showWindow()
                host.mainWindow()?.webContents.send('browser:shortcut-requested', 'pick-element')
              }
            },
            { type: 'separator' },
            {
              label: host.text('native.menu.back'),
              // Chrome's keys. As keys of the menu they reach it only when the website or field in focus leaves them
              // alone, as in Chrome, and never from an agent: Chromium keeps the keys an agent sends from the menu.
              accelerator: process.platform === 'darwin' ? 'Cmd+[' : 'Alt+Left',
              click: (_item, window, event) => goInHistory('back', window, event)
            },
            {
              label: host.text('native.menu.forward'),
              accelerator: process.platform === 'darwin' ? 'Cmd+]' : 'Alt+Right',
              click: (_item, window, event) => goInHistory('forward', window, event)
            },
            {
              label: host.text('native.menu.reload'),
              accelerator: 'CmdOrCtrl+R',
              click: () => host.runNativeBrowserAction('reload', () => host.tabs()?.reload())
            },
            {
              label: host.text('native.menu.reloadWithoutCache'),
              accelerator: 'CmdOrCtrl+Shift+R',
              click: () => host.runNativeBrowserAction('reload without cache', () => host.tabs()?.reloadIgnoringCache())
            },
            ...websiteKeptKeys(),
            {
              label: host.text('native.menu.developerTools'),
              click: () => host.runNativeBrowserAction('toggle Developer Tools', () => host.tabs()?.toggleDevTools())
            },
            {
              label: host.text('native.menu.fullPageView'),
              accelerator: 'CmdOrCtrl+Shift+F',
              click: () => {
                host.showWindow()
                host.mainWindow()?.webContents.send('browser:shortcut-requested', 'toggle-full-page')
              }
            },
            { type: 'separator' },
            {
              label: host.text('native.menu.print'),
              // Chrome's key, which a website may keep, such as an online editor printing its document itself: as the
              // menu's key it reaches the menu only when the website or field in focus leaves it alone, and never from
              // an agent. Typed in a panel in its own window, it would print a page out of view.
              accelerator: 'CmdOrCtrl+P',
              click: (_item, window, event) => {
                if (event.triggeredByAccelerator && (window === undefined || window.id !== host.mainWindow()?.id)) return
                host.runNativeBrowserAction('print the page', () => host.tabs()?.printShownPage())
              }
            },
            { type: 'separator' },
            {
              label: host.text('native.menu.actualSize'),
              accelerator: 'CmdOrCtrl+0',
              click: () => host.runNativeBrowserAction('reset page zoom', () => host.tabs()?.setZoom({ action: 'reset' }))
            },
            {
              label: host.text('native.menu.zoomIn'),
              accelerator: 'CmdOrCtrl+Plus',
              click: () => host.runNativeBrowserAction('zoom in', () => host.tabs()?.setZoom({ action: 'in' }))
            },
            {
              label: host.text('native.menu.zoomOut'),
              accelerator: 'CmdOrCtrl+-',
              click: () => host.runNativeBrowserAction('zoom out', () => host.tabs()?.setZoom({ action: 'out' }))
            },
            { role: 'togglefullscreen' }
          ]
        },
        {
          label: host.text('native.menu.help'),
          submenu: [
            {
              label: host.text('native.menu.shortcuts'),
              accelerator: 'CmdOrCtrl+Shift+/',
              click: () => requestHelp('shortcuts')
            },
            { label: host.text('native.menu.about'), click: () => requestHelp('about') },
            { label: host.text('native.menu.support'), click: () => requestHelp('support') },
            { type: 'separator' },
            { label: host.text('native.menu.repository'), click: openRepository },
            {
              label: host.text('native.menu.checkUpdatesPlain'),
              click: () => {
                host.showWindow()
                host.mainWindow()?.webContents.send('updates:open')
                void host.checkForUpdates()
              }
            }
          ]
        }
      ])
    )
  }

  return { installApplicationMenu }
}
