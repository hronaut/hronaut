import { javascriptLiteral } from '../../../shared/javascript-literal.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import { normalizePageUrlWaitPattern, pageUrlMatchesWait } from '../../../shared/page-url-wait.js'
import { LocalizedError } from '../../localized-error.js'
import { targetStateScript } from '../page-scripts.js'
import type { PageWaitsAccess } from './page-waits-access.js'

/** Waits until the tab stops loading, rejecting if it closes, loses its renderer or times out. */
export async function waitForPage(access: PageWaitsAccess, tabId?: string, timeoutMs = 30_000): Promise<void> {
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  const rendererUnavailable = (): boolean => tab.pageProblem?.kind === 'renderer-gone'
  const rendererUnavailableError = (): Error => new LocalizedError('appErrors.page.rendererLostWhileWaiting')
  if (webContents.isDestroyed()) throw new LocalizedError('appErrors.page.closedWhileWaiting')
  if (rendererUnavailable()) throw rendererUnavailableError()
  try {
    if (!webContents.isLoading()) return
  } catch {
    throw new LocalizedError('appErrors.page.closedWhileWaiting')
  }
  await new Promise<void>((resolve, reject) => {
    let stopSettlement: NodeJS.Immediate | undefined
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      if (stopSettlement) clearImmediate(stopSettlement)
      webContents.removeListener('did-stop-loading', onDidStopLoading)
      webContents.removeListener('did-fail-load', onDidFailLoad)
      webContents.removeListener('render-process-gone', onRenderProcessGone)
      webContents.removeListener('destroyed', onDestroyed)
    }
    const done = (): void => {
      cleanup()
      resolve()
    }
    const onDidStopLoading = (): void => {
      if (stopSettlement) return
      // Chromium reports loading stopped before Electron reports a crashed
      // renderer. Defer success for one turn so renderer loss wins. During
      // intentional renderer recovery, the replacement load may already be
      // underway; keep waiting for that load's terminal event.
      stopSettlement = setImmediate(() => {
        stopSettlement = undefined
        if (rendererUnavailable() || (
          webContents.isCrashed() && !access.rendererExpectsExit(webContents)
        )) {
          rejectForRendererUnavailable()
          return
        }
        if (webContents.isDestroyed()) {
          onDestroyed()
          return
        }
        try {
          if (!webContents.isLoading()) done()
        } catch {
          onDestroyed()
        }
      })
    }
    const onDidFailLoad = (
      _event: Electron.Event,
      _errorCode: number,
      _errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ): void => {
      if (isMainFrame) done()
    }
    const onDestroyed = (): void => {
      cleanup()
      reject(new LocalizedError('appErrors.page.closedWhileWaiting'))
    }
    const rejectForRendererUnavailable = (): void => {
      cleanup()
      reject(rendererUnavailableError())
    }
    const onRenderProcessGone = (): void => {
      // The permanent lifecycle listener runs first and records a
      // renderer-gone problem for an unexpected exit. Intentional renderer
      // replacement during unresponsive-page recovery leaves it clear, so
      // that reload can continue to the next did-stop-loading event.
      if (!rendererUnavailable()) return
      rejectForRendererUnavailable()
    }
    const onTimeout = (): void => {
      cleanup()
      reject(new LocalizedError('appErrors.page.loadTimedOut'))
    }
    const timer = setTimeout(onTimeout, Math.min(Math.max(timeoutMs, 1), 60_000))
    webContents.on('did-stop-loading', onDidStopLoading)
    webContents.on('did-fail-load', onDidFailLoad)
    webContents.on('render-process-gone', onRenderProcessGone)
    webContents.once('destroyed', onDestroyed)
    // Loading can finish, or the tab can close, between the initial state
    // check and listener registration. Recheck both after every listener is
    // installed so neither terminal state can leave this wait stranded.
    if (webContents.isDestroyed()) {
      onDestroyed()
    } else if (rendererUnavailable()) {
      onRenderProcessGone()
    } else {
      try {
        if (!webContents.isLoading()) onDidStopLoading()
      } catch {
        onDestroyed()
      }
    }
  })
}

/** Polls the page text until a candidate appears (or, for hidden, none does), returning null on timeout. */
export async function waitForText(
  access: PageWaitsAccess,
  text: string | readonly string[],
  tabId?: string,
  timeoutMs = 30_000,
  state: 'visible' | 'hidden' = 'visible'
): Promise<string | null> {
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  const candidates = typeof text === 'string' ? [text] : [...text]
  if (!candidates.length) throw new TypeError('At least one text candidate is required.')
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 1), 60_000)
  const evaluationDeadline = Symbol('text-wait-deadline')
  while (Date.now() < deadline) {
    if (!access.hasTab(tab.id) || webContents.isDestroyed()) {
      throw new Error('The tab closed while waiting for page text.')
    }
    let match: string | null
    let onDestroyed: () => void = () => undefined
    let evaluationTimer: NodeJS.Timeout | undefined
    try {
      // Without a user gesture, so that waiting never gives the page a person's activation.
      const evaluation = webContents.executeJavaScript(
        `(() => { const pageText = document.body?.innerText ?? ''; return ${javascriptLiteral(candidates)}.find((candidate) => pageText.includes(candidate)) ?? null })()`,
        false
      )
      const closed = new Promise<never>((_resolve, reject) => {
        onDestroyed = () => reject(new Error('The tab closed while waiting for page text.'))
        webContents.once('destroyed', onDestroyed)
      })
      const timedOut = new Promise<typeof evaluationDeadline>((resolve) => {
        evaluationTimer = setTimeout(() => resolve(evaluationDeadline), Math.max(1, deadline - Date.now()))
      })
      // Register the close race before checking state again so no teardown
      // gap can strand executeJavaScript while an unfinished page is loading.
      const pending = Promise.race([evaluation, closed, timedOut])
      if (!access.hasTab(tab.id) || webContents.isDestroyed()) {
        throw new Error('The tab closed while waiting for page text.')
      }
      const result = await pending
      if (result === evaluationDeadline) return null
      match = typeof result === 'string' ? result : null
    } catch (error) {
      if (!access.hasTab(tab.id) || webContents.isDestroyed()) {
        throw new Error('The tab closed while waiting for page text.')
      }
      throw error
    } finally {
      if (evaluationTimer) clearTimeout(evaluationTimer)
      webContents.removeListener('destroyed', onDestroyed)
    }
    if (state === 'visible' ? match !== null : match === null) {
      return state === 'visible' ? match : (candidates[0] ?? null)
    }
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}

/** Polls a ref or selector until it reaches the requested state, returning false on timeout. */
export async function waitForElement(
  access: PageWaitsAccess,
  target: { ref?: string; selector?: string },
  tabId?: string,
  timeoutMs = 30_000,
  state: 'attached' | 'detached' | 'visible' | 'hidden' = 'visible'
): Promise<boolean> {
  access.validateTarget(target)
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 1), 60_000)
  const evaluationDeadline = Symbol('element-wait-deadline')
  const expression = targetStateScript(target, state)
  while (Date.now() < deadline) {
    if (!access.hasTab(tab.id) || webContents.isDestroyed()) {
      throw new Error('The tab closed while waiting for the page element.')
    }
    let onDestroyed: () => void = () => undefined
    let evaluationTimer: NodeJS.Timeout | undefined
    try {
      // Without a user gesture, so that waiting never gives the page a person's activation.
      const evaluation = webContents.executeJavaScript(expression, false) as Promise<{ matches?: boolean }>
      const closed = new Promise<never>((_resolve, reject) => {
        onDestroyed = () => reject(new Error('The tab closed while waiting for the page element.'))
        webContents.once('destroyed', onDestroyed)
      })
      const timedOut = new Promise<typeof evaluationDeadline>((resolve) => {
        evaluationTimer = setTimeout(() => resolve(evaluationDeadline), Math.max(1, deadline - Date.now()))
      })
      const pending = Promise.race([evaluation, closed, timedOut])
      if (!access.hasTab(tab.id) || webContents.isDestroyed()) {
        throw new Error('The tab closed while waiting for the page element.')
      }
      const result = await pending
      if (result === evaluationDeadline) return false
      if (result?.matches === true) return true
    } catch (error) {
      if (!access.hasTab(tab.id) || webContents.isDestroyed()) {
        throw new Error('The tab closed while waiting for the page element.')
      }
      throw error
    } finally {
      if (evaluationTimer) clearTimeout(evaluationTimer)
      webContents.removeListener('destroyed', onDestroyed)
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

/** Waits for a main-frame navigation whose URL matches the pattern, returning the redacted URL or null on timeout. */
export async function waitForUrlPattern(
  access: PageWaitsAccess,
  urlPattern: string,
  tabId?: string,
  timeoutMs = 30_000
): Promise<string | null> {
  const pattern = normalizePageUrlWaitPattern(urlPattern)
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  const timeout = Math.min(Math.max(timeoutMs, 1), 60_000)
  const rendererUnavailable = (): boolean => tab.pageProblem?.kind === 'renderer-gone'
  if (webContents.isDestroyed()) throw new Error('The tab closed while waiting for the page URL.')
  if (rendererUnavailable()) throw new Error('The tab renderer became unavailable while waiting for the page URL.')

  return new Promise<string | null>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      webContents.removeListener('did-navigate', onNavigate)
      webContents.removeListener('did-navigate-in-page', onNavigateInPage)
      webContents.removeListener('render-process-gone', onRenderProcessGone)
      webContents.removeListener('destroyed', onDestroyed)
    }
    const finish = (url: string | null): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(url ? redactNetworkUrl(url) : null)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const match = (url: string): void => {
      if (pageUrlMatchesWait(pattern, url)) finish(url)
    }
    const onNavigate = (_event: Electron.Event, url: string): void => match(url)
    const onNavigateInPage = (_event: Electron.Event, url: string, isMainFrame: boolean): void => {
      if (isMainFrame) match(url)
    }
    const onRenderProcessGone = (): void => {
      // Intentional renderer replacement during unresponsive-page recovery
      // leaves the renderer-gone problem clear and the URL wait active.
      if (rendererUnavailable()) {
        fail(new Error('The tab renderer became unavailable while waiting for the page URL.'))
      }
    }
    const onDestroyed = (): void => fail(new Error('The tab closed while waiting for the page URL.'))
    const timer = setTimeout(() => finish(null), timeout)
    webContents.on('did-navigate', onNavigate)
    webContents.on('did-navigate-in-page', onNavigateInPage)
    webContents.on('render-process-gone', onRenderProcessGone)
    webContents.once('destroyed', onDestroyed)
    // Register every listener before checking the current URL so a route
    // change or teardown cannot land in the setup gap.
    if (!access.hasTab(tab.id) || webContents.isDestroyed()) onDestroyed()
    else if (rendererUnavailable()) onRenderProcessGone()
    else match(webContents.getURL() || tab.url)
  })
}

