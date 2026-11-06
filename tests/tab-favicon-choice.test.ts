import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadFavicon } from '../src/main/browser/tab-favicon/tab-favicon.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

/** A decoded icon of this size, which says its size in the PNG it gives once scaled to the tab's 32 pixels. */
function decoded(size: number) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: size, height: size }),
    resize: () => ({ toPNG: () => Buffer.from(`icon ${size}`) })
  }
}

vi.mock('electron', () => ({ nativeImage: { createEmpty: () => ({ isEmpty: () => true }) } }))
// Each icon's bytes are its size; one of 0 cannot be decoded.
vi.mock('../src/main/browser/favicon.js', () => ({
  decodeWebsiteFavicon: async (bytes: Buffer) => {
    const size = Number(bytes.toString())
    return size ? decoded(size) : { isEmpty: () => true }
  }
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ publishChange: vi.fn() }))

/** A page whose icons, by their addresses, are this many pixels and arrive after this many milliseconds. */
function page(icons: Record<string, { size: number; after: number }>) {
  const fetches: { url: string; signal: AbortSignal }[] = []
  const tab = {
    faviconRequestId: 0,
    webContents: {
      isDestroyed: () => false,
      session: {
        fetch: (url: string, { signal }: { signal: AbortSignal }) => {
          fetches.push({ url, signal })
          const icon = icons[new URL(url).pathname.slice(1)]!
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response(String(icon.size))), icon.after)
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(signal.reason)
            })
          })
        }
      }
    }
  } as unknown as BrowserTab
  const urls = Object.keys(icons).map((name) => `https://site.example/${name}`)
  const shown = () => tab.faviconDataUrl ? Buffer.from(tab.faviconDataUrl.split(',')[1]!, 'base64').toString() : undefined
  return { tab, urls, fetches, shown, load: () => loadFavicon({ destroyed: false } as Browser, tab, urls) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the icon a tab shows', () => {
  // The tab showed whichever of the page's icons arrived first, so a small one listed beside a large one, often the
  // quickest, was scaled up to the tab's 32 pixels and blurred.
  it('is the first in the page\'s order that is at least 32 pixels, not the one that arrives first', async () => {
    vi.useFakeTimers()
    const icons = page({ small: { size: 16, after: 0 }, large: { size: 192, after: 30 }, medium: { size: 64, after: 10 } })

    const loading = icons.load()
    await vi.advanceTimersByTimeAsync(30)
    await loading

    expect(icons.shown()).toBe('icon 192')
  })

  it('does not wait for the icons after the one it shows, which stop loading', async () => {
    vi.useFakeTimers()
    const icons = page({ first: { size: 48, after: 5 }, slow: { size: 96, after: 60_000 } })

    const loading = icons.load()
    await vi.advanceTimersByTimeAsync(5)
    await loading

    expect(icons.shown()).toBe('icon 48')
    expect(icons.fetches.map(({ signal }) => signal.aborted)).toEqual([true, true])
  })

  it('is the largest when none is that large, and stays as it was when none can be decoded', async () => {
    vi.useFakeTimers()
    const small = page({ tiny: { size: 16, after: 0 }, broken: { size: 0, after: 0 }, larger: { size: 24, after: 5 } })
    const loading = small.load()
    await vi.advanceTimersByTimeAsync(5)
    await loading
    expect(small.shown()).toBe('icon 24')

    const broken = page({ broken: { size: 0, after: 0 }, alsoBroken: { size: 0, after: 1 } })
    broken.tab.faviconDataUrl = `data:image/png;base64,${Buffer.from('icon before').toString('base64')}`
    const failing = broken.load()
    await vi.advanceTimersByTimeAsync(1)
    await failing
    expect(broken.shown()).toBe('icon before')
  })
})
