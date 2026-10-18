import { app, Menu, type BrowserWindow } from 'electron'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { AppUpdateState, HelpMenuAction } from '../../shared/types.js'

interface ApplicationMenuHost {
  /** Translates into the current interface language; read on every build because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  showWindow(): void
  /** The main window; read on every use because it is created after the menu and goes when it closes. */
  mainWindow(): Pick<BrowserWindow, 'webContents'> | null
  checkForUpdates(): Promise<AppUpdateState>
  /** Marks the app as quitting, so closing the window quits instead of hiding it in the tray. */
  setQuitting(value: boolean): void
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  runNativeBrowserAction(action: string, callback: () => unknown): void
  tabs(): Pick<BrowserTabsManager, 'newTab' | 'reload' | 'reloadIgnoringCache' | 'toggleDevTools' | 'setZoom'> | null
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
              click: () => {
                host.setQuitting(true)
                app.quit()
              }
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
              label: host.text('native.menu.reload'),
              accelerator: 'CmdOrCtrl+R',
              click: () => host.runNativeBrowserAction('reload', () => host.tabs()?.reload())
            },
            {
              label: host.text('native.menu.reloadWithoutCache'),
              accelerator: 'CmdOrCtrl+Shift+R',
              click: () => host.runNativeBrowserAction('reload without cache', () => host.tabs()?.reloadIgnoringCache())
            },
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
