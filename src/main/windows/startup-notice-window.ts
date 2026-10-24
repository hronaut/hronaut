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
/** Longer than the page ever takes to load; past it, the system dialog says it instead. */
const LOAD_TIMEOUT_MS = 10_000

function noticeAddress(notice: StartupNotice, options: StartupNoticeWindowOptions): { file: string; query: Record<string, string> } | { url: string } {
  const query = { theme: options.theme, lang: options.locale, ...notice }
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL('startup-notice.html', process.env.ELECTRON_RENDERER_URL)
    url.search = new URLSearchParams(query).toString()
    return { url: url.href }
  }
  return { file: join(__dirname, '../renderer/startup-notice.html'), query }
}

/** Loads the notice and sizes the window to it, whose length depends on the language. */
async function load(window: BrowserWindow, notice: StartupNotice, options: StartupNoticeWindowOptions): Promise<void> {
  const address = noticeAddress(notice, options)
  if ('url' in address) await window.loadURL(address.url)
  else await window.loadFile(address.file, { query: address.query })
  const height = Number(await window.webContents.executeJavaScript('document.documentElement.scrollHeight'))
  window.setContentSize(WIDTH, Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(Number.isFinite(height) ? height : MIN_HEIGHT))))
}

/**
 * Shows a notice in a small Hronaut window of its own, styled as Hronaut's dialogs, for a failure before the main
 * window exists or can be shown, and resolves once the window closes: by the person, or by a quit from elsewhere.
 * Rejects when the window cannot show the notice, does not load it in time or loses its page, so the caller can fall
 * back to the system dialog. The page has no preload and no menu, and can only close itself.
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
    backgroundColor: options.background,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  // The application menu's commands are for the main window; none of them belongs here.
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  // A close asked for, by the person or by a quit, ends the notice; its page going away fails it.
  let closing = false
  window.once('close', () => { closing = true })
  const ended = new Promise<void>((resolve, reject) => {
    window.once('closed', () => resolve())
    window.webContents.once('render-process-gone', () => {
      reject(new Error('The startup notice lost its page'))
      if (!window.isDestroyed()) window.destroy()
    })
  })
  // Awaited below once the window shows; a failure before then is the load's to report.
  ended.catch(() => undefined)
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      load(window, notice, options),
      ended.then(() => { throw new Error('The startup notice closed while it loaded') }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The startup notice did not load in time')), LOAD_TIMEOUT_MS) })
    ])
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    // A quit while the notice loaded leaves nothing to tell.
    if (closing) return
    throw error
  } finally {
    clearTimeout(timer)
  }
  window.center()
  window.show()
  window.focus()
  await ended
}
