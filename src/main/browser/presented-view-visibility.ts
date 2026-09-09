import type { BrowserWindow, WebContents, WebContentsView } from 'electron'

const pending = new WeakSet<WebContentsView>()
const VISIBILITY_WORLD_ID = 1010

/** Repair Electron 44's stale native visibility without reloading or focusing. */
export function reconcilePresentedViewVisibility(window: BrowserWindow, view: WebContentsView): void {
  if (process.platform !== 'linux' || process.versions.electron?.split('.')[0] !== '44' || pending.has(view)) return
  const contents = view.webContents
  const isPresented = (): boolean => !window.isDestroyed()
    && !contents.isDestroyed()
    && window.isVisible()
    && !window.isMinimized()
    && window.contentView.children.includes(view)
    && view.getVisible()
    && !contents.isLoadingMainFrame()
  if (!isPresented()) return
  pending.add(view)
  void contents.executeJavaScriptInIsolatedWorld(VISIBILITY_WORLD_ID, [{ code: 'document.visibilityState' }], false)
    .then(visibility => {
      if (visibility !== 'hidden' || !isPresented()) return
      // Electron 44's View visibility/bounds can already be correct while its
      // RenderWidgetHost remains hidden. Reapplying them does not call WasShown.
      // setEmbedder performs WasHidden/WasShown and preserves the live document,
      // focus and background throttling. This internal API is deliberately
      // feature-checked and restricted to the verified Electron major version.
      // https://github.com/electron/electron/blob/v44.2.0/shell/browser/api/electron_api_web_contents.cc
      const nativeContents = contents as WebContents & { setEmbedder?: (embedder: WebContents) => void }
      nativeContents.setEmbedder?.(window.webContents)
    })
    // Navigation or destruction can invalidate the isolated execution context.
    .catch(() => undefined)
    .finally(() => pending.delete(view))
}

/** Check idle presented pages too: compositor visibility can drift without a
 * navigation or layout event. Only the caller's displayed views are inspected. */
export function watchPresentedViewVisibility(
  window: BrowserWindow,
  displayedViews: () => readonly WebContentsView[]
): () => void {
  if (process.platform !== 'linux' || process.versions.electron?.split('.')[0] !== '44') return () => undefined
  const timer = setInterval(() => {
    if (window.isDestroyed()) { clearInterval(timer); return }
    if (!window.isVisible() || window.isMinimized()) return
    for (const view of displayedViews().slice(0, 2)) reconcilePresentedViewVisibility(window, view)
  }, 1_000)
  timer.unref()
  return () => clearInterval(timer)
}
