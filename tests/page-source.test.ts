import { describe, expect, it, vi } from 'vitest'
import { pageSourceAddress, viewFrameSource, viewPageSource, viewShownPageSource } from '../src/main/browser/page-source/page-source.js'

// Hronaut had no View Page Source: Ctrl+U and Cmd+Option+U did nothing, and neither menu offered it.

type Tab = { id: string; url: string; mcpGroupId?: string }

function sourceAccess(shown?: Tab, occluded = false) {
  return {
    shownTab: () => shown,
    browserContentOccluded: () => occluded,
    createTab: vi.fn(async (_options: { url: string; active: boolean; mcpGroupId?: string; openedFrom: { tabId: string; background: boolean } }) => undefined)
  }
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
    const access = sourceAccess()
    await expect(viewPageSource(access, tab)).resolves.toBe(true)
    expect(access.createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'view-source:https://shop.example/cart',
      active: true,
      mcpGroupId: 'client-a',
      openedFrom: { tabId: 'shop', background: false }
    })
  })

  it('opens the shown page\'s source, and nothing without a web page or behind Hronaut\'s own dialogs', async () => {
    const tab = { id: 'shop', url: 'https://shop.example/', mcpGroupId: 'client-a' }
    const shown = sourceAccess(tab)
    await expect(viewShownPageSource(shown)).resolves.toBe(true)
    expect(shown.createTab).toHaveBeenCalledOnce()

    for (const access of [
      sourceAccess(),
      sourceAccess(tab, true),
      sourceAccess({ id: 'home', url: 'hronaut://home/' }),
      sourceAccess({ id: 'source', url: 'view-source:https://shop.example/', mcpGroupId: 'client-a' })
    ]) {
      await expect(viewShownPageSource(access)).resolves.toBe(false)
      expect(access.createTab).not.toHaveBeenCalled()
    }
  })

  // A dialog of Hronaut's can open while the page's context menu is open.
  it('opens nothing from the page\'s context menu once a dialog of Hronaut\'s covers the page', async () => {
    const access = sourceAccess(undefined, true)
    await expect(viewPageSource(access, { id: 'shop', url: 'https://shop.example/' })).resolves.toBe(false)
    expect(access.createTab).not.toHaveBeenCalled()
  })

  it('passes on a tab that could not open, such as one the workspace refuses', async () => {
    const access = sourceAccess()
    const refused = new Error('This workspace does not allow that address.')
    access.createTab.mockRejectedValueOnce(refused)
    await expect(viewPageSource(access, { id: 'shop', url: 'https://shop.example/' })).rejects.toBe(refused)
  })

  it('opens a frame\'s source in a new tab beside its page, for a frame showing a web page and not behind Hronaut\'s dialogs', async () => {
    const tab = { id: 'shop', url: 'https://shop.example/checkout', mcpGroupId: 'client-a' }
    const access = sourceAccess()
    await expect(viewFrameSource(access, tab, 'https://pay.example/card')).resolves.toBe(true)
    expect(access.createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'view-source:https://pay.example/card',
      active: true,
      mcpGroupId: 'client-a',
      openedFrom: { tabId: 'shop', background: false }
    })

    const covered = sourceAccess(undefined, true)
    await expect(viewFrameSource(covered, tab, 'https://pay.example/card')).resolves.toBe(false)
    await expect(viewFrameSource(access, tab, 'about:srcdoc')).resolves.toBe(false)
    expect(covered.createTab).not.toHaveBeenCalled()
    expect(access.createTab).toHaveBeenCalledOnce()
  })
})
