import { describe, expect, it, vi } from 'vitest'
import { stopFocusedPageLoading } from '../src/main/browser/page-navigation/page-navigation.js'

// Escape did nothing on a loading page, where Chrome stops it once the page leaves the key alone.

function focusedPage(page: { loading?: boolean; url?: string; destroyed?: boolean } | null) {
  const webContents = page && {
    isDestroyed: () => page.destroyed === true,
    isLoading: () => page.loading === true,
    getURL: () => page.url ?? 'https://example.test/',
    stop: vi.fn()
  }
  const access = { focusedTab: () => webContents ? { webContents } : undefined }
  stopFocusedPageLoading(access as never)
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
