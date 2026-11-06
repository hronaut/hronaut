import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadFavicon } from '../src/main/browser/tab-favicon/tab-favicon.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

/** A decoded icon of this size, which says its size in the PNG it gives once scaled to the tab's 32 pixels. */
function decoded(size: string) {
  const [width, height = width] = size.split('x').map(Number)
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: () => ({ toPNG: () => Buffer.from(`icon ${size}`) })
  }
}

vi.mock('electron', () => ({ nativeImage: { createEmpty: () => ({ isEmpty: () => true }) } }))
// Each icon's bytes are its size, such as 16 or 64x16; one of 0 cannot be decoded.
vi.mock('../src/main/browser/favicon.js', () => ({
  decodeWebsiteFavicon: async (bytes: Buffer) => bytes.toString() === '0' ? { isEmpty: () => true } : decoded(bytes.toString())
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ publishChange: vi.fn() }))

/** A page whose icons, by their addresses, are this many pixels and arrive after this many milliseconds. */
function page(icons: Record<string, { size: number | string; after: number }>) {
  const fetches: { url: string; signal: AbortSignal }[] = []
  const tab = {
    url: 'https://site.example/page',
    documentGeneration: 0,
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
  const onSiteIcon = vi.fn<(page: { url: string; icon: string }) => void>()
  const browser = { destroyed: false, options: { onSiteIcon } } as unknown as Browser
  return { tab, urls, fetches, shown, onSiteIcon, browser, load: () => loadFavicon(browser, tab, urls) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the icon a tab shows', () => {
  // The tab showed whichever of the page's icons arrived first, so a small one listed beside a large one, often the
  // quickest, was scaled up to the tab's 32 pixels and blurred.
  it('is replaced by a larger one that arrives later, until one is at least 32 pixels, and the rest stop loading', async () => {
    vi.useFakeTimers()
    const icons = page({ small: { size: 16, after: 0 }, larger: { size: 24, after: 5 }, large: { size: 64, after: 10 }, largest: { size: 192, after: 30 } })

    const loading = icons.load()
    await vi.advanceTimersByTimeAsync(0)
    expect(icons.shown()).toBe('icon 16')
    await vi.advanceTimersByTimeAsync(5)
    expect(icons.shown()).toBe('icon 24')
    await vi.advanceTimersByTimeAsync(5)
    await loading

    expect(icons.shown()).toBe('icon 64')
    expect(icons.fetches.map(({ signal }) => signal.aborted)).toEqual([true, true, true, true])
    // History and Bookmarks hear of each icon the tab showed, for its page.
    expect(icons.onSiteIcon.mock.calls.map(([{ icon }]) => Buffer.from(icon.split(',')[1]!, 'base64').toString())).toEqual(['icon 16', 'icon 24', 'icon 64'])
    expect(icons.onSiteIcon).toHaveBeenCalledWith(expect.objectContaining({ url: icons.tab.url }))
  })

  // Each icon list a page gave replaced its icon in History and Bookmarks, so a mail page's unread count, a build's status
  // or an animated icon's frames took the page's place there, and were saved again and again.
  it('gives History and Bookmarks only the first icon list a document gives for its page', async () => {
    vi.useFakeTimers()
    const icons = page({ small: { size: 16, after: 0 }, large: { size: 64, after: 5 }, badge: { size: 48, after: 0 }, route: { size: 40, after: 0 } })
    const given = () => icons.onSiteIcon.mock.calls.map(([{ url, icon }]) => `${url} ${Buffer.from(icon.split(',')[1]!, 'base64').toString()}`)
    const load = async (names: string[]) => {
      const loading = loadFavicon(icons.browser, icons.tab, names.map((name) => `https://site.example/${name}`))
      await vi.advanceTimersByTimeAsync(5)
      await loading
    }

    await load(['small', 'large'])
    // The page's own icon list, as each larger icon of it arrives.
    expect(given()).toEqual(['https://site.example/page icon 16', 'https://site.example/page icon 64'])

    // The tab shows the badge the page gives later, but History and Bookmarks keep the page's icon.
    await load(['badge'])
    expect(icons.shown()).toBe('icon 48')
    // A link to a section of the page is still the page.
    icons.tab.url = 'https://site.example/page#comments'
    await load(['badge'])
    expect(given()).toHaveLength(2)

    // A route the page's document goes to is a page of its own, and the same page loaded again is a new document.
    icons.tab.url = 'https://site.example/route'
    await load(['route'])
    icons.tab.url = 'https://site.example/page'
    icons.tab.documentGeneration += 1
    await load(['badge'])
    expect(given().slice(2)).toEqual(['https://site.example/route icon 40', 'https://site.example/page icon 48'])
  })

  it('does not wait for an icon listed before the one it shows', async () => {
    vi.useFakeTimers()
    const icons = page({ slow: { size: 96, after: 60_000 }, quick: { size: 48, after: 5 } })

    const loading = icons.load()
    await vi.advanceTimersByTimeAsync(5)
    await loading

    expect(icons.shown()).toBe('icon 48')
  })

  it('ends with the largest when none is that large, and stays as it was when none can be decoded', async () => {
    vi.useFakeTimers()
    const small = page({
      tiny: { size: 16, after: 0 }, broken: { size: 0, after: 0 }, larger: { size: 24, after: 5 }, smaller: { size: 20, after: 8 },
      // An icon counts by its shorter side.
      wide: { size: '64x16', after: 9 }
    })
    const loading = small.load()
    await vi.advanceTimersByTimeAsync(9)
    await loading
    expect(small.shown()).toBe('icon 24')

    const broken = page({ broken: { size: 0, after: 0 }, alsoBroken: { size: 0, after: 1 } })
    broken.tab.faviconDataUrl = `data:image/png;base64,${Buffer.from('icon before').toString('base64')}`
    const failing = broken.load()
    await vi.advanceTimersByTimeAsync(1)
    await failing
    expect(broken.shown()).toBe('icon before')
  })

  it('shows nothing of an icon list a newer one superseded', async () => {
    vi.useFakeTimers()
    const icons = page({ old: { size: 48, after: 10 }, current: { size: 64, after: 20 } })

    const superseded = loadFavicon(icons.browser, icons.tab, [icons.urls[0]!])
    const current = loadFavicon(icons.browser, icons.tab, [icons.urls[1]!])
    await vi.advanceTimersByTimeAsync(20)
    await Promise.all([superseded, current])

    expect(icons.shown()).toBe('icon 64')
    expect(icons.fetches[0]!.signal.aborted).toBe(true)
  })
})
