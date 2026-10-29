import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { pageSourceAddress, viewFrameSource, viewPageSource, viewShownPageSource } from '../src/main/browser/page-source/page-source.js'

// Hronaut had no View Page Source: Ctrl+U and Cmd+Option+U did nothing, and neither menu offered it.

type Tab = { id: string; url: string; mcpGroupId?: string }

/** A browser showing this tab, if any, with or without a dialog of Hronaut's over the page. */
function sourceBrowser(shown?: Tab, occluded = false) {
  const createTab = vi.fn(async (_options: { url: string; active: boolean; mcpGroupId?: string; openedFrom: { tabId: string; background: boolean } }) => undefined)
  const browser = { activeTabId: shown?.id, tabs: new Map(shown ? [[shown.id, shown]] : []), browserContentOccluded: occluded, createTab }
  return browser as unknown as Browser & { createTab: typeof createTab }
}

describe('View Page Source', () => {
  it('has a source address for a web page only', () => {
    expect(pageSourceAddress('https://shop.example/cart?item=2#total')).toBe('view-source:https://shop.example/cart?item=2#total')
    expect(pageSourceAddress('http://127.0.0.1:3000/')).toBe('view-source:http://127.0.0.1:3000/')
    for (const url of ['hronaut://home/', 'view-source:https://shop.example/', 'about:blank', 'data:text/html,hi', 'file:///tmp/page.html', 'blob:https://shop.example/1']) {
      expect(pageSourceAddress(url), url).toBeUndefined()
    }
  })

  it('opens the source in a new tab beside the page, in front and in the page\'s workspace', async () => {
    const tab = { id: 'shop', url: 'https://shop.example/cart', mcpGroupId: 'client-a' }
    const browser = sourceBrowser()
    await expect(viewPageSource(browser, tab)).resolves.toBe(true)
    expect(browser.createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'view-source:https://shop.example/cart',
      active: true,
      mcpGroupId: 'client-a',
      openedFrom: { tabId: 'shop', background: false }
    })
  })

  it('opens the shown page\'s source, and nothing without a web page or behind Hronaut\'s own dialogs', async () => {
    const tab = { id: 'shop', url: 'https://shop.example/', mcpGroupId: 'client-a' }
    const shown = sourceBrowser(tab)
    await expect(viewShownPageSource(shown)).resolves.toBe(true)
    expect(shown.createTab).toHaveBeenCalledOnce()

    for (const browser of [
      sourceBrowser(),
      sourceBrowser(tab, true),
      sourceBrowser({ id: 'home', url: 'hronaut://home/' }),
      sourceBrowser({ id: 'source', url: 'view-source:https://shop.example/', mcpGroupId: 'client-a' })
    ]) {
      await expect(viewShownPageSource(browser)).resolves.toBe(false)
      expect(browser.createTab).not.toHaveBeenCalled()
    }
  })

  // A dialog of Hronaut's can open while the page's context menu is open.
  it('opens nothing from the page\'s context menu once a dialog of Hronaut\'s covers the page', async () => {
    const browser = sourceBrowser(undefined, true)
    await expect(viewPageSource(browser, { id: 'shop', url: 'https://shop.example/' })).resolves.toBe(false)
    expect(browser.createTab).not.toHaveBeenCalled()
  })

  it('passes on a tab that could not open, such as one the workspace refuses', async () => {
    const browser = sourceBrowser()
    const refused = new Error('This workspace does not allow that address.')
    browser.createTab.mockRejectedValueOnce(refused)
    await expect(viewPageSource(browser, { id: 'shop', url: 'https://shop.example/' })).rejects.toBe(refused)
  })

  it('opens a frame\'s source in a new tab beside its page, for a frame showing a web page and not behind Hronaut\'s dialogs', async () => {
    const tab = { id: 'shop', url: 'https://shop.example/checkout', mcpGroupId: 'client-a' }
    const browser = sourceBrowser()
    await expect(viewFrameSource(browser, tab, 'https://pay.example/card')).resolves.toBe(true)
    expect(browser.createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'view-source:https://pay.example/card',
      active: true,
      mcpGroupId: 'client-a',
      openedFrom: { tabId: 'shop', background: false }
    })

    const covered = sourceBrowser(undefined, true)
    await expect(viewFrameSource(covered, tab, 'https://pay.example/card')).resolves.toBe(false)
    await expect(viewFrameSource(browser, tab, 'about:srcdoc')).resolves.toBe(false)
    expect(covered.createTab).not.toHaveBeenCalled()
    expect(browser.createTab).toHaveBeenCalledOnce()
  })
})
