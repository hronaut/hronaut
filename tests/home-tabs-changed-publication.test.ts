import { describe, expect, it, vi } from 'vitest'

// The state read is the browser's own; this one carries a counter, so each publication differs from the last.
let reads = 0
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ buildBrowserState: () => ({ tabs: [], reads: ++reads }) }))

const { createStatePublication } = await import('../src/main/browser/browser-state/browser-state-publication.js')

function contents() {
  return { send: vi.fn(), isDestroyed: () => false }
}

describe('telling Home its tabs changed', () => {
  it('tells each open Home, and no website, with a notice that carries nothing', () => {
    const shell = contents()
    const home = contents()
    const website = contents()
    const browser = {
      destroyed: false,
      restoringLayout: false,
      window: { isDestroyed: () => false, webContents: shell },
      options: {},
      activeTabId: 'page',
      splitView: null,
      tabs: new Map([
        ['home', { id: 'home', url: 'hronaut://home/', loading: false, webContents: home }],
        ['page', { id: 'page', url: 'https://example.com/', loading: false, webContents: website }]
      ])
    }
    const publication = createStatePublication(browser as never)
    publication.changed()
    expect(shell.send).toHaveBeenCalledOnce()
    expect(home.send.mock.calls).toStrictEqual([['hronaut-home:tabs-changed']])
    expect(website.send).not.toHaveBeenCalled()
    publication.dispose()
  })
})
