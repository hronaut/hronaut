import { describe, expect, it, vi } from 'vitest'
import { stopFocusedPageLoading } from '../src/main/browser/page-navigation/page-navigation.js'

/** The page with the keyboard, as Electron reports it. */
const keyboard = vi.hoisted(() => ({ focused: null as { id: number } | null }))
vi.mock('electron', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  webContents: { getFocusedWebContents: () => keyboard.focused }
}))

// Escape did nothing on a loading page, where Chrome stops it once the page leaves the key alone.

function focusedPage(page: { loading?: boolean; url?: string; destroyed?: boolean } | null) {
  const webContents = page && {
    id: 7,
    isDestroyed: () => page.destroyed === true,
    isLoading: () => page.loading === true,
    getURL: () => page.url ?? 'https://example.test/',
    stop: vi.fn()
  }
  keyboard.focused = webContents
  const browser = {
    webContentsToTab: new Map(webContents ? [[webContents.id, 'tab']] : []),
    tabs: new Map(webContents ? [['tab', { id: 'tab', webContents }]] : [])
  }
  stopFocusedPageLoading(browser as never)
  return webContents?.stop
}

describe('Escape left alone by the page in focus', () => {
  it('stops that page while it loads', () => {
    expect(focusedPage({ loading: true })).toHaveBeenCalledOnce()
  })

  it('leaves a page that has loaded its own requests, Home and a closed page alone', () => {
    expect(focusedPage({ loading: false })).not.toHaveBeenCalled()
    // Hronaut loads Home again by itself, which Escape would leave half shown.
    expect(focusedPage({ loading: true, url: 'hronaut://home/' })).not.toHaveBeenCalled()
    expect(focusedPage({ loading: true, destroyed: true })).not.toHaveBeenCalled()
    expect(() => focusedPage(null)).not.toThrow()
  })
})
