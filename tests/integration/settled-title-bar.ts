import { expect, type Page } from '@playwright/test'

/**
 * A new interface scale changes how many CSS pixels the native window controls take, and a new window size reaches the
 * viewport and the overlay at different moments. The title bar gives the controls their new room once the overlay
 * reports it (useTitleBarPresentationController), and with tabs on the left the toolbar moves when it lands. Wait until
 * the viewport has its new CSS width and the published insets match the overlay's own report before reading where to
 * click with native input.
 */
export async function waitForSettledTitleBar(appWindow: Page, viewportWidth: number): Promise<void> {
  await expect.poll(() => appWindow.evaluate((viewportWidth) => {
    if (window.innerWidth !== viewportWidth) return false
    if (document.documentElement.dataset.titleBarMode !== 'overlay') return true
    const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean, getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay
    if (!overlay?.visible) return false
    const area = overlay.getTitlebarAreaRect()
    const published = (name: string) => Number.parseFloat(document.documentElement.style.getPropertyValue(name))
    return Math.abs(published('--titlebar-controls-left-runtime') - area.x) < 0.5
      && Math.abs(published('--titlebar-controls-right-runtime') - (window.innerWidth - area.x - area.width)) < 0.5
  }, viewportWidth), { message: 'the title bar gives the window controls their room at the new size' }).toBe(true)
}
