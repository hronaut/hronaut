import { describe, expect, it } from 'vitest'
import { isSourceViewUrl, refusePageScriptsInSourceView, SourceViewError } from '../src/main/browser/source-view-guard.js'

// An agent's browser_snapshot on a tab showing a page's source (view-source:) never answered: Electron never settles a
// page script there.

function fakePage(url: string) {
  const state = { url, destroyed: false }
  const calls: Array<{ kind: string; args: unknown[] }> = []
  const page = {
    isDestroyed: () => state.destroyed,
    getURL: () => state.url,
    executeJavaScript: async (...args: unknown[]) => { calls.push({ kind: 'script', args }); return 'ran' },
    executeJavaScriptInIsolatedWorld: async (...args: unknown[]) => { calls.push({ kind: 'isolated', args }); return 'ran' }
  }
  refusePageScriptsInSourceView(page as never)
  return { page, state, calls }
}

describe('page scripts in a page\'s source', () => {
  it('tells a source address in any case', () => {
    expect(isSourceViewUrl('view-source:https://shop.example/')).toBe(true)
    expect(isSourceViewUrl('VIEW-SOURCE:https://shop.example/')).toBe(true)
    for (const url of ['https://shop.example/view-source:x', 'view-source', 'about:blank', '']) expect(isSourceViewUrl(url), url).toBe(false)
  })

  it('refuses page scripts unsent while the page shows a source, with a reason an agent can act on', async () => {
    const { page, calls } = fakePage('view-source:https://shop.example/')
    const script = page.executeJavaScript('document.title', true)
    const isolated = page.executeJavaScriptInIsolatedWorld(7, [{ code: 'document.title' }])
    await expect(script).rejects.toBeInstanceOf(SourceViewError)
    await expect(isolated).rejects.toMatchObject({
      name: 'SourceViewError',
      key: 'appErrors.page.sourceViewRunsNoScripts',
      message: expect.stringContaining('nothing was sent to it. Open the page itself')
    })
    expect(calls).toEqual([])
  })

  it('runs them on the page itself, and again once the tab leaves the source', async () => {
    const { page, state, calls } = fakePage('https://shop.example/')
    await expect(page.executeJavaScript('1')).resolves.toBe('ran')
    state.url = 'view-source:https://shop.example/'
    await expect(page.executeJavaScript('2')).rejects.toBeInstanceOf(SourceViewError)
    state.url = 'https://shop.example/next'
    await expect(page.executeJavaScriptInIsolatedWorld(7, [{ code: '3' }])).resolves.toBe('ran')
    expect(calls.map(call => call.kind)).toEqual(['script', 'isolated'])
  })

  it('leaves a page that is gone to Electron, which reports it', async () => {
    const { page, state, calls } = fakePage('view-source:https://shop.example/')
    state.destroyed = true
    await expect(page.executeJavaScript('1')).resolves.toBe('ran')
    expect(calls).toHaveLength(1)
  })
})
