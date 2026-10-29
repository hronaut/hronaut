import { expect, it, vi } from 'vitest'
// The browser below stubs publishPageGeometry and focusTabOrTrustedChrome, which taking the page out of view and back reach through these.
vi.mock('../src/main/browser/page-geometry/page-geometry.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-geometry/page-geometry.js')>(),
  publishPageGeometry: (browser: { publishPageGeometry: () => void }) => browser.publishPageGeometry()
}))
vi.mock('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js')>(),
  focusTabOrTrustedChrome: (browser: { focusTabOrTrustedChrome: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.focusTabOrTrustedChrome(...args)
}))
import { stageBeforeUnloadClose } from '../src/main/browser/tab-close/before-unload-staging.js'

/** The active tab of a window with no other tab, whose page asks before it closes. */
function activeTab() {
  const children: unknown[] = []
  const view = { getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), getVisible: () => true, setBounds: vi.fn(), setVisible: vi.fn() }
  const tab = { id: 'draft', webContents: { isDestroyed: () => false }, view }
  children.push(view)
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    splitView: null,
    splitViewContains: () => false,
    window: {
      contentView: {
        children,
        addChildView: (child: unknown) => { if (!children.includes(child)) children.push(child) },
        removeChildView: (child: unknown) => { if (children.includes(child)) children.splice(children.indexOf(child), 1) }
      }
    },
    closeTabTransition: () => ({ splitPartnerId: null, nextId: undefined }),
    tabViewBounds: () => view.getBounds(),
    publishPageGeometry: vi.fn(),
    layout: vi.fn(),
    focusTabOrTrustedChrome: vi.fn()
  }
  return { browser, tab, children }
}

it('brings a page whose close was prevented back, with the keyboard only when it had it', () => {
  for (const focusPage of [true, false]) {
    const { browser, tab, children } = activeTab()
    const staged = stageBeforeUnloadClose(browser as never, tab as never)
    expect(children).not.toContain(tab.view)

    staged.rollback(focusPage)
    expect(children).toContain(tab.view)
    // A person in Hronaut's own controls keeps the keyboard there, and a question asked next takes it anyway.
    expect(browser.focusTabOrTrustedChrome).toHaveBeenCalledTimes(focusPage ? 1 : 0)
  }
})
