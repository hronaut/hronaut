import type { BrowserWindow } from 'electron'

/** How far the shell's tab rail and page frame reach into the window below the toolbar, in window pixels. */
export interface ContentInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * What sizing the area the pages show in needs from the tab manager, which
 * keeps the window, the shell's toolbar height and content insets and layout
 * private. The toolbar height and insets stay manager fields because layout
 * and the split divider read them too; they are written back through their
 * setters and read again at every use.
 */
export interface ContentAreaAccess {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The shell's toolbar height, in window pixels. */
  toolbarHeight(): number
  /** Records the shell's toolbar height. */
  writeToolbarHeight(height: number): void
  /** How far the shell reaches into the window below the toolbar. */
  contentInsets(): ContentInsets
  /** Records how far the shell reaches into the window below the toolbar. */
  writeContentInsets(insets: ContentInsets): void
  /** Lays out the visible tabs. */
  layout(): void
}
