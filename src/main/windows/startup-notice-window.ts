import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ResolvedThemeName } from '../../shared/theme.js'

/** A notice for a failure before the main window can show anything, already in the interface language. */
export interface StartupNotice {
  title: string
  message: string
  detail: string
  /** The one button's label; it closes the notice. */
  quit: string
}

interface StartupNoticeWindowOptions {
  theme: ResolvedThemeName
  /** The theme's window background, shown before the page paints. */
  background: string
  /** The interface language, for the page's `lang`. */
  locale: string
}

const WIDTH = 480
const MIN_HEIGHT = 180
const MAX_HEIGHT = 560

function noticeAddress(notice: StartupNotice, options: StartupNoticeWindowOptions): { file: string; query: Record<string, string> } | { url: string } {
  const query = { theme: options.theme, lang: options.locale, ...notice }
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL('startup-notice.html', process.env.ELECTRON_RENDERER_URL)
    url.search = new URLSearchParams(query).toString()
    return { url: url.href }
  }
  return { file: join(__dirname, '../renderer/startup-notice.html'), query }
}

/**
 * Shows a notice in a small Hronaut window of its own, styled as Hronaut's dialogs, for a failure before the main
 * window exists or can be shown, and resolves once the person closes it. Rejects when the window cannot show the
 * notice, so the caller can fall back to the system dialog. The page has no preload and can only close itself.
 */
export async function showStartupNoticeWindow(notice: StartupNotice, options: StartupNoticeWindowOptions): Promise<void> {
  const window = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: notice.title,
    autoHideMenuBar: true,
    backgroundColor: options.background,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const closed = new Promise<void>((resolve) => window.once('closed', () => resolve()))
  try {
    const address = noticeAddress(notice, options)
    if ('url' in address) await window.loadURL(address.url)
    else await window.loadFile(address.file, { query: address.query })
    // The window fits the notice, whose length depends on the language.
    const height = Number(await window.webContents.executeJavaScript('document.documentElement.scrollHeight'))
    window.setContentSize(WIDTH, Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(Number.isFinite(height) ? height : MIN_HEIGHT))))
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  window.center()
  window.show()
  window.focus()
  await closed
}
