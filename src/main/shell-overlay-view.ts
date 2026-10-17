import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'

export interface ShellOverlayViewOptions {
  /** Names the view in errors and logs. */
  name: string
  /** Absolute path of the view's own preload script. */
  preload: string
  /** The trusted shell page the view loads; navigation anywhere else is refused. */
  url: () => string
  window: () => BrowserWindow | null
  urlMatches: (actual: string | undefined, expected: string) => boolean
  /** The view's renderer went away, with anything it showed. */
  onLost: () => void
  /** Other overlay views that stay above this one when both show, such as the agent card above a toast. */
  keepAbove?: () => readonly unknown[]
}

export interface LoadedShellOverlayView {
  view: WebContentsView
  webContents: WebContents
}

interface OverlayIpcEvent {
  sender: WebContents
  senderFrame?: { url: string } | null
}

/**
 * One transparent, sandboxed view that draws shell UI above the page views without
 * covering them. It loads on first use and is in the window only while presented.
 */
export class ShellOverlayView {
  private current: LoadedShellOverlayView | null = null
  private loading: Promise<LoadedShellOverlayView> | null = null

  constructor(private readonly options: ShellOverlayViewOptions) {}

  /** True for IPC sent by this view's own trusted page. */
  isSender(event: OverlayIpcEvent): boolean {
    return !!this.current
      && event.sender === this.current.webContents
      && this.options.urlMatches(event.senderFrame?.url, this.options.url())
  }

  /** True for this view's own contents. */
  owns(contents: WebContents): boolean {
    return this.current?.webContents === contents
  }

  /** The loaded view, whether or not it is in the window now. */
  currentView(): WebContentsView | null {
    return this.current?.view ?? null
  }

  ensure(): Promise<LoadedShellOverlayView> {
    if (this.loading) return this.loading
    const opening = this.open()
    this.loading = opening
    return opening
  }

  /**
   * Puts the view on top of the window's views, above a page attached meanwhile, and shows it; below the overlays it
   * keeps above it, when they show.
   */
  present(): void {
    const loaded = this.current
    const window = this.options.window()
    if (!loaded || loaded.webContents.isDestroyed() || !window || window.isDestroyed()) return
    const above = this.options.keepAbove?.() ?? []
    const children = window.contentView.children
    const index = children.indexOf(loaded.view)
    // In place while only those overlays sit above it: a view already there keeps its focus, and they keep theirs.
    if (index < 0 || !children.slice(index + 1).every((child) => above.includes(child))) {
      // Adding a child view again moves it to the top, whatever index it is given, so it comes out first.
      if (above.length && index >= 0) window.contentView.removeChildView(loaded.view)
      const rest = window.contentView.children
      const at = rest.findLastIndex((child) => !above.includes(child)) + 1
      if (at < rest.length) window.contentView.addChildView(loaded.view, at)
      else window.contentView.addChildView(loaded.view)
    }
    loaded.view.setVisible(true)
  }

  withdraw(): void {
    const loaded = this.current
    if (!loaded || loaded.webContents.isDestroyed()) return
    loaded.view.setVisible(false)
    this.detach(loaded.view)
  }

  /** Closes the view; the next ensure() loads a new one. */
  close(): void {
    const loaded = this.current
    this.current = null
    this.loading = null
    if (loaded && !loaded.webContents.isDestroyed()) loaded.webContents.close()
  }

  private async open(): Promise<LoadedShellOverlayView> {
    const expectedUrl = this.options.url()
    const view = new WebContentsView({
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    const webContents = view.webContents
    const loaded = { view, webContents }
    this.current = loaded
    try {
      view.setBackgroundColor('#00000000')
      view.setVisible(false)
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      webContents.on('will-navigate', (event, url) => {
        if (!this.options.urlMatches(url, expectedUrl)) event.preventDefault()
      })
      webContents.on('destroyed', () => {
        if (this.current?.webContents !== webContents) return
        this.current = null
        this.loading = null
        this.options.onLost()
        try {
          this.detach(view)
        } catch (error) {
          console.error(`[${this.options.name}] Failed to detach the view:`, error)
        }
      })
      webContents.on('render-process-gone', () => {
        if (!webContents.isDestroyed()) webContents.close()
      })
      await webContents.loadURL(expectedUrl)
      const window = this.options.window()
      if (!window || window.isDestroyed()) throw new Error(`The main window closed before the ${this.options.name} view loaded`)
      return loaded
    } catch (error) {
      if (!webContents.isDestroyed()) webContents.close()
      if (this.current?.webContents === webContents) this.current = null
      this.loading = null
      throw error
    }
  }

  private detach(view: WebContentsView): void {
    const window = this.options.window()
    if (window && !window.isDestroyed() && window.contentView.children.includes(view)) {
      window.contentView.removeChildView(view)
    }
  }
}
