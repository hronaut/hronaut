import type { ElectronApplication, Page } from '@playwright/test'

export interface ToastView {
  visible: boolean
  topmost: boolean
  bounds: { x: number; y: number; width: number; height: number }
  text: string
  focused: string | null
}

/** The native view main draws toasts in, while it is in the window. */
export async function toastView(electronApp: ElectronApplication): Promise<ToastView | null> {
  return electronApp.evaluate(async ({ BrowserWindow }) => {
    const isToast = (child: Electron.View): boolean => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('toast-overlay.html')
    )
    const children = BrowserWindow.getAllWindows().find((window) => window.contentView.children.some(isToast))?.contentView.children ?? []
    const view = children.find(isToast) as Electron.WebContentsView | undefined
    if (!view) return null
    const content = await view.webContents.executeJavaScript(`({
      text: document.querySelector('.toast-overlay')?.textContent ?? '',
      focused: document.querySelector('.toast-overlay [data-focused="true"]')?.className ?? null
    })`) as Pick<ToastView, 'text' | 'focused'>
    return { visible: view.getVisible(), topmost: children.at(-1) === view, bounds: view.getBounds(), ...content }
  })
}

/** The text of the toast main draws above the page, or null while it draws none. */
export async function toastText(electronApp: ElectronApplication): Promise<string | null> {
  const view = await toastView(electronApp)
  return view?.visible ? view.text : null
}

/**
 * The text of the toast the person sees: the one main draws above the page, or the shell's own copy where main cannot
 * draw it. The shell's copy is in the accessibility tree either way, but visually hidden while main draws the toast.
 */
export async function visibleToastText(electronApp: ElectronApplication, appWindow: Page): Promise<string | null> {
  const drawn = await toastText(electronApp)
  if (drawn !== null) return drawn
  const shell = appWindow.locator('.app-toast-region:not(.mirrored) .app-toast')
  return await shell.count() ? (await shell.allTextContents()).join('\n') : null
}
