import { expect, it, vi } from 'vitest'
import { stageBeforeUnloadClose } from '../src/main/browser/tab-close/before-unload-staging.js'
import type { BeforeUnloadStagingAccess, BeforeUnloadStagingTab } from '../src/main/browser/tab-close/before-unload-staging-access.js'

/** The active tab of a window with no other tab, whose page asks before it closes. */
function activeTab() {
  const children: unknown[] = []
  const view = { getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), getVisible: () => true, setBounds: vi.fn(), setVisible: vi.fn() }
  const tab = { id: 'draft', webContents: { isDestroyed: () => false }, view } as unknown as BeforeUnloadStagingTab
  children.push(view)
  const access = {
    findTab: (tabId: string) => tabId === tab.id ? tab : undefined,
    activeTabId: () => tab.id,
    splitView: () => null,
    splitViewContains: () => false,
    window: () => ({
      contentView: {
        children,
        addChildView: (child: unknown) => { if (!children.includes(child)) children.push(child) },
        removeChildView: (child: unknown) => { if (children.includes(child)) children.splice(children.indexOf(child), 1) }
      }
    }),
    closeTabTransition: () => ({ splitPartnerId: null, nextId: undefined }),
    contentAreaBounds: () => view.getBounds(),
    tabViewBounds: () => view.getBounds(),
    roundPageCorners: vi.fn(),
    publishPageGeometry: vi.fn(),
    layout: vi.fn(),
    focusTabOrTrustedChrome: vi.fn()
  }
  return { access: access as unknown as BeforeUnloadStagingAccess<BeforeUnloadStagingTab> & typeof access, tab, children }
}

it('brings a page whose close was prevented back, with the keyboard only when it had it', () => {
  for (const focusPage of [true, false]) {
    const { access, tab, children } = activeTab()
    const staged = stageBeforeUnloadClose(access, tab)
    expect(children).not.toContain(tab.view)

    staged.rollback(focusPage)
    expect(children).toContain(tab.view)
    // A person in Hronaut's own controls keeps the keyboard there, and a question asked next takes it anyway.
    expect(access.focusTabOrTrustedChrome).toHaveBeenCalledTimes(focusPage ? 1 : 0)
  }
})
