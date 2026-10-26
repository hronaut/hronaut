import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { ISOLATED_WORLDS } from './isolated-worlds.js'

const pending = new WeakSet<WebContentsView>()
const VISIBILITY_WORLD_ID = ISOLATED_WORLDS.presentedViewVisibility
const VISIBILITY_PROBE_TIMEOUT_MS = 1_500

function repairsVisibility(): boolean {
  return process.platform === 'linux' && process.versions.electron?.split('.')[0] === '44'
}

function viewContents(view: WebContentsView): WebContents | undefined {
  try {
    // Electron can invalidate this native getter while a child view is being
    // torn down. The periodic recovery check must not turn that expected race
    // into an uncaught main-process exception.
    return view.webContents
  } catch {
    return undefined
  }
}

function isPresented(window: BrowserWindow, view: WebContentsView, contents: WebContents): boolean {
  try {
    return !window.isDestroyed()
      && !contents.isDestroyed()
      && window.isVisible()
      && !window.isMinimized()
      && window.contentView.children.includes(view)
      && view.getVisible()
      && !contents.isLoadingMainFrame()
  } catch {
    // Any native wrapper in this predicate can become invalid between the
    // periodic watcher selecting a view and checking its presentation.
    return false
  }
}

/**
 * Electron 44's View visibility/bounds can already be correct while its
 * RenderWidgetHost remains hidden. Reapplying them does not call WasShown.
 * setEmbedder performs WasHidden/WasShown and preserves the live document,
 * focus and background throttling. This internal API is deliberately
 * feature-checked and restricted to the verified Electron major version.
 * https://github.com/electron/electron/blob/v44.2.0/shell/browser/api/electron_api_web_contents.cc
 */
function showRenderer(window: BrowserWindow, contents: WebContents): void {
  const nativeContents = contents as WebContents & { setEmbedder?: (embedder: WebContents) => void }
  nativeContents.setEmbedder?.(window.webContents)
}

/** Repair Electron 44's stale native visibility without reloading or focusing. */
export function reconcilePresentedViewVisibility(window: BrowserWindow, view: WebContentsView): void {
  if (!repairsVisibility() || pending.has(view)) return
  const contents = viewContents(view)
  if (!contents) return
  const presented = (): boolean => isPresented(window, view, contents)
  if (!presented()) return
  pending.add(view)
  let probe: ReturnType<WebContents['executeJavaScriptInIsolatedWorld']>
  try {
    probe = contents.executeJavaScriptInIsolatedWorld(
      VISIBILITY_WORLD_ID,
      [{ code: 'document.visibilityState' }],
      false
    )
  } catch {
    pending.delete(view)
    return
  }
  let timeout: NodeJS.Timeout | undefined
  const deadline = new Promise<undefined>((resolve) => {
    const deadlineTimer = setTimeout(resolve, VISIBILITY_PROBE_TIMEOUT_MS) as unknown as NodeJS.Timeout
    timeout = deadlineTimer
    deadlineTimer.unref()
  })
  void Promise.race([
    probe,
    deadline
  ])
    .then(visibility => {
      if (visibility !== 'hidden' || !presented()) return
      showRenderer(window, contents)
    })
    // Navigation or destruction can invalidate the isolated execution context.
    .catch(() => undefined)
    .finally(() => {
      if (timeout) clearTimeout(timeout)
      pending.delete(view)
    })
}

/**
 * Shows the page of a presented view that Hronaut has just resumed. Chromium hides a page it freezes
 * (Page.setWebLifecycleState calls WasHidden) and does not show it when it resumes, which left the page's timers and
 * frames throttled until a check found it hidden. The page is known to be hidden, so it is shown without a check.
 */
export function showResumedPresentedView(window: BrowserWindow, view: WebContentsView): void {
  if (!repairsVisibility()) return
  const contents = viewContents(view)
  if (contents && isPresented(window, view, contents)) showRenderer(window, contents)
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
