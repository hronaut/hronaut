import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { Browser } from '../src/main/browser/browser.js'
import type { PersistedBrowserState } from '../src/main/browser/tab-store.js'

function fixture() {
  const tab = { id: 'target', title: 'Page', url: 'https://example.test/', label: 'Previous' }
  const tabs = new Map([[tab.id, tab]])
  let commit!: () => void
  let reject!: (error: Error) => void
  const store = { save: vi.fn((snapshot: () => PersistedBrowserState, hooks: { beforeCommit: () => void; onCommitted: () => void }) => {
    snapshot()
    return new Promise<void>((resolve, fail) => {
      reject = fail
      commit = () => {
        try { hooks.beforeCommit(); hooks.onCommitted(); resolve() } catch (error) { fail(error) }
      }
    })
  }) }
  const manager = Object.assign(Object.create(Browser.prototype), {
    initialized: true, destroyed: false, tabLabelAdmissionClosed: false, tabLabelLifecycleHolds: 0,
    pendingTabLabels: new Set(), tabs, store, changed: vi.fn(),
    getTab: () => tab, getState: () => ({ tabs: [...tabs.values()] }),
    persistedState: () => ({ version: 3, activeTabId: tab.id, tabs: [{ ...tab }] })
  }) as Browser
  return { manager, store, tab, tabs, commit: () => commit(), reject: (error: Error) => reject(error) }
}

it('fences new edits synchronously at shutdown while allowing an admitted save to settle', async () => {
  const { manager, store, tab, commit } = fixture()
  const admitted = manager.setTabLabel(tab.id, 'Admitted role')
  manager.stopTabLabelEdits()
  await expect(manager.setTabLabel(tab.id, 'Late role')).rejects.toThrow('Wait for the tab operation')
  expect(store.save).toHaveBeenCalledOnce()
  expect(tab.label).toBe('Previous')
  commit()
  expect((await admitted).status).toBe('saved')
  expect(tab.label).toBe('Admitted role')
})

it('rejects a stale tab before replacement without acknowledging or changing its prior label', async () => {
  const { manager, tab, tabs, commit } = fixture()
  const pending = manager.setTabLabel(tab.id, 'Stale role')
  const rejected = expect(pending).rejects.toThrow('no longer available')
  tabs.delete(tab.id)
  commit()
  await rejected
  expect(tab.label).toBe('Previous')
})

it('holds lifecycle copies until rejected edits settle and rejects new edits during the hold', async () => {
  const { manager, tab, reject } = fixture()
  const edit = manager.setTabLabel(tab.id, 'Rejected role')
  const rejected = expect(edit).rejects.toThrow('synthetic write failure')
  const copy = vi.fn(async () => tab.label)
  const lifecycle = (manager as unknown as { withTabLabelLifecycle<T>(run: () => Promise<T>): Promise<T> }).withTabLabelLifecycle(copy)
  expect(copy).not.toHaveBeenCalled()
  await expect(manager.setTabLabel(tab.id, 'During close')).rejects.toThrow('Wait for the tab operation')
  reject(new Error('synthetic write failure'))
  await rejected
  expect(await lifecycle).toBe('Previous')
  expect(copy).toHaveBeenCalledOnce()
})
