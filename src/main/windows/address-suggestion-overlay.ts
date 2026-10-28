import { app, WebContentsView, webContents as electronWebContents, type IpcMainEvent, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { scaleShellMetric } from '../../shared/interface-scale.js'
import type { MainWindowRefs } from './main-window.js'
import type {
  AddressSuggestionOverlayRequest,
  AddressSuggestionOverlayState,
  AddressSuggestionSelection
} from '../../shared/address-suggestions.js'
import type { AppSettings, SupportedLocale } from '../../shared/types.js'

interface AddressSuggestionSurface {
  view: WebContentsView
  webContents: WebContents
  sessionId: number
}

interface AddressSuggestionOverlayHost {
  /** The trusted shell document; the suggestions page is served beside it. */
  trustedShellUrl(): string
  /** Whether a frame's address is the expected trusted page, with or without a fragment. */
  trustedUrlMatches(actual: string | undefined, expected: string): boolean
  /** The main window the suggestions show over; its window is read on every use because it can close. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** The current settings, for the interface scale; read on every use because each committed update replaces them. */
  settings(): Pick<AppSettings, 'interfaceScale'>
  /** The interface language the suggestions are labelled in; read on every use because it can change. */
  resolvedLocale(): SupportedLocale
}

export interface AddressSuggestionOverlay {
  /** Whether a report came from the suggestions page in the current view, which a view the window closed is not. */
  isAddressOverlaySender(event: IpcMainEvent): boolean
  /** Shows the shell's suggestions under the address field, loading the view first if needed. */
  show(request: AddressSuggestionOverlayRequest, sender: Pick<WebContents, 'getZoomFactor'>): void
  /** Hides the suggestions when the shell asks, including after a dismissal it acknowledges. */
  hide(): void
  /** Sizes the shown suggestions to the height their page measured. */
  measured(value: unknown, sender: Pick<WebContents, 'getZoomFactor'>): void
  /** Hands the shell a pick from the current typing session, and hides the view unless the row opens behind. */
  select(selection: AddressSuggestionSelection): void
  /** Gives the keyboard back to the shell's address field after a middle-click on a row took it to the view. */
  returnFocus(): void
  /** The suggestions view while one exists, which a toast keeps below it. */
  currentView(): WebContentsView | undefined
  /** True for the suggestions view's own contents. */
  owns(contents: WebContents): boolean
  /** Applies a new interface scale to the suggestions view. */
  setZoomFactor(scale: number): void
  /** Closes the view and forgets its state once the main window closed. */
  mainWindowClosed(): void
}

/**
 * The address field's suggestions, drawn in their own transparent view above the page views of the main window. The
 * view loads on the first suggestions and stays for later ones; a crashed or closed view is dismissed until the shell
 * acknowledges it with hide, so a stale update cannot bring it back.
 */
export function createAddressSuggestionOverlay(host: AddressSuggestionOverlayHost): AddressSuggestionOverlay {
  let addressSuggestionSurface: AddressSuggestionSurface | null = null
  let addressSuggestionSurfaceLoad: Promise<AddressSuggestionSurface> | null = null
  let addressSuggestionOverlayGeneration = 0
  let addressSuggestionOverlayBounds: { x: number; y: number; width: number; maxHeight: number } | null = null
  let addressSuggestionOverlayVisible = false
  let addressSuggestionOverlayDismissalPending = false

  function trustedAddressOverlayUrl(): string {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      return new URL('address-overlay.html', host.trustedShellUrl()).href
    }
    return pathToFileURL(join(__dirname, '../renderer/address-overlay.html')).href
  }

  function isAddressOverlaySender(event: Electron.IpcMainEvent): boolean {
    return !!addressSuggestionSurface
      && event.sender === addressSuggestionSurface.webContents
      && host.trustedUrlMatches(event.senderFrame?.url, trustedAddressOverlayUrl())
  }

  function hideAddressSuggestionOverlay(): void {
    addressSuggestionOverlayVisible = false
    addressSuggestionOverlayBounds = null
    const surface = addressSuggestionSurface
    const window = host.mainWindowRefs.window
    if (!surface) return
    if (!surface.webContents.isDestroyed()) surface.view.setVisible(false)
    if (window && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(surface.view)
      } catch (error) {
        console.error('[address-overlay] Failed to detach suggestion view:', error)
      }
    }
  }

  async function ensureAddressSuggestionView(sessionId: number): Promise<AddressSuggestionSurface> {
    // A view exists before its preload and renderer are ready to receive state.
    // Every concurrent typing update must wait for that same initial load.
    if (addressSuggestionSurfaceLoad) {
      if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
        addressSuggestionSurface.sessionId = sessionId
      }
      return addressSuggestionSurfaceLoad
    }
    if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
      addressSuggestionSurface.sessionId = sessionId
      return addressSuggestionSurface
    }
    const opening = (async () => {
      const expectedUrl = trustedAddressOverlayUrl()
      const view = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/addressOverlay.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false
        }
      })
      // Cache WebContents while the native view is intact. Electron can
      // invalidate WebContentsView.webContents during native teardown, so every
      // asynchronous lifecycle path must use this stable reference instead of
      // reading the getter again.
      const webContents = view.webContents
      const surface: AddressSuggestionSurface = { view, webContents, sessionId }
      addressSuggestionSurface = surface
      try {
        view.setBackgroundColor('#00000000')
        view.setVisible(false)
        webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        webContents.on('will-navigate', (event, url) => {
          if (!host.trustedUrlMatches(url, expectedUrl)) event.preventDefault()
        })
        webContents.on('destroyed', () => {
          if (addressSuggestionSurface !== surface) return
          addressSuggestionOverlayGeneration += 1
          addressSuggestionOverlayDismissalPending = true
          hideAddressSuggestionOverlay()
          addressSuggestionSurface = null
          if (host.mainWindowRefs.window && !host.mainWindowRefs.window.isDestroyed() && !host.mainWindowRefs.window.webContents.isDestroyed()) {
            host.mainWindowRefs.window.webContents.send('address-overlay:dismissed', surface.sessionId)
          }
        })
        webContents.on('render-process-gone', () => {
          // A crashed renderer leaves its WebContents alive. Destroy that cached
          // surface so the existing dismissal path allows fresh input to recreate it.
          if (!webContents.isDestroyed()) webContents.close()
        })
        await webContents.loadURL(expectedUrl)
        // Initial navigation resets the view's zoom. Apply the latest shell
        // scale after loading, before sending state or measuring the popup.
        if (!webContents.isDestroyed()) webContents.setZoomFactor(host.settings().interfaceScale)
        return surface
      } catch (error) {
        if (!webContents.isDestroyed()) webContents.close()
        if (addressSuggestionSurface === surface) addressSuggestionSurface = null
        throw error
      }
    })()
    addressSuggestionSurfaceLoad = opening
    try {
      return await opening
    } finally {
      if (addressSuggestionSurfaceLoad === opening) addressSuggestionSurfaceLoad = null
    }
  }

  function show(request: AddressSuggestionOverlayRequest, sender: Pick<WebContents, 'getZoomFactor'>): void {
    // When the native renderer exits unexpectedly, ignore any already-queued
    // show requests until the shell acknowledges the dismissal with hide.
    // This prevents a stale resize/reactivity update from resurrecting the
    // dead popup before fresh user input opens a new one.
    if (addressSuggestionOverlayDismissalPending) return
    const generation = ++addressSuggestionOverlayGeneration
    const scale = sender.getZoomFactor()
    const bounds = {
      x: scaleShellMetric(request.bounds.x, scale),
      y: scaleShellMetric(request.bounds.y, scale),
      width: scaleShellMetric(request.bounds.width, scale),
      maxHeight: scaleShellMetric(request.bounds.maxHeight, scale)
    }
    const state: AddressSuggestionOverlayState = {
      sessionId: request.sessionId,
      suggestions: request.suggestions,
      selectedIndex: request.selectedIndex,
      ...(request.selectedAction ? { selectedAction: request.selectedAction } : {}),
      theme: request.theme,
      locale: host.resolvedLocale()
    }
    void ensureAddressSuggestionView(request.sessionId).then(({ view, webContents }) => {
      if (
        generation !== addressSuggestionOverlayGeneration
        || !host.mainWindowRefs.window
        || host.mainWindowRefs.window.isDestroyed()
        || webContents.isDestroyed()
      ) return
      addressSuggestionOverlayVisible = true
      addressSuggestionOverlayBounds = bounds
      // Suggestions on screen stay there until the view has measured the new ones, as Chrome's list updates in place.
      // Hiding them for each update, as a visit or a bookmark saved meanwhile brings, made the list blink, and a click
      // on it then went nowhere. Only a hidden view waits for its first measurement.
      const height = view.getVisible() ? Math.min(view.getBounds().height, bounds.maxHeight) : 1
      view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(1, height) })
      host.mainWindowRefs.window.contentView.addChildView(view)
      webContents.send('address-overlay:state', state)
    }).catch((error) => console.error('[address-overlay] Failed to show suggestions:', error))
  }

  function hide(): void {
    addressSuggestionOverlayDismissalPending = false
    addressSuggestionOverlayGeneration += 1
    hideAddressSuggestionOverlay()
  }

  function measured(value: unknown, sender: Pick<WebContents, 'getZoomFactor'>): void {
    if (
      !addressSuggestionOverlayVisible
      || !addressSuggestionOverlayBounds
      || !addressSuggestionSurface
      || !host.mainWindowRefs.window
      || host.mainWindowRefs.window.isDestroyed()
      || typeof value !== 'number'
      || !Number.isFinite(value)
      || value <= 0
    ) return
    const height = Math.min(
      addressSuggestionOverlayBounds.maxHeight,
      scaleShellMetric(value, sender.getZoomFactor())
    )
    addressSuggestionSurface.view.setBounds({
      x: addressSuggestionOverlayBounds.x,
      y: addressSuggestionOverlayBounds.y,
      width: addressSuggestionOverlayBounds.width,
      height: Math.max(1, height)
    })
    addressSuggestionSurface.view.setVisible(true)
    // Re-adding an existing child explicitly makes the overlay the topmost
    // native view, including after a website tab was selected meanwhile.
    host.mainWindowRefs.window.contentView.addChildView(addressSuggestionSurface.view)
  }

  function select(selection: AddressSuggestionSelection): void {
    if (selection.sessionId !== addressSuggestionSurface?.sessionId) return
    if (host.mainWindowRefs.window && !host.mainWindowRefs.window.isDestroyed() && !host.mainWindowRefs.window.webContents.isDestroyed()) {
      host.mainWindowRefs.window.webContents.send('address-overlay:selected', selection)
    }
    // A row opened behind leaves the suggestions open, as in Chrome; the shell hides them itself if its field lost focus.
    if (selection.disposition) return
    addressSuggestionOverlayGeneration += 1
    hideAddressSuggestionOverlay()
  }

  function returnFocus(): void {
    const window = host.mainWindowRefs.window
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !window.isFocused()) return
    // Only from the suggestions view, which the press on its row focused, or from nowhere once the view hid; focus that
    // has moved to a page or a panel since stays there.
    const focused = electronWebContents.getFocusedWebContents()
    if (focused && focused !== addressSuggestionSurface?.webContents) return
    window.webContents.focus()
  }

  function currentView(): WebContentsView | undefined {
    return addressSuggestionSurface?.view
  }

  function owns(contents: WebContents): boolean {
    return addressSuggestionSurface?.webContents === contents
  }

  function setZoomFactor(scale: number): void {
    if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
      addressSuggestionSurface.webContents.setZoomFactor(scale)
    }
  }

  function mainWindowClosed(): void {
    if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
      addressSuggestionSurface.webContents.close()
    }
    addressSuggestionSurface = null
    addressSuggestionSurfaceLoad = null
    addressSuggestionOverlayBounds = null
    addressSuggestionOverlayVisible = false
    addressSuggestionOverlayDismissalPending = false
  }

  return { isAddressOverlaySender, show, hide, measured, select, returnFocus, currentView, owns, setZoomFactor, mainWindowClosed }
}
