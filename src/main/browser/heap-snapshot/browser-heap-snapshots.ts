import { getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { HeapSnapshots, type HeapSnapshotOptions, type HeapSnapshotReport } from './heap-snapshots.js'

/** Heap snapshots of the browser's tabs, through Hronaut's own DevTools session on each page. */
export function createHeapSnapshots(browser: Browser): HeapSnapshots<BrowserTab> {
  return new HeapSnapshots<BrowserTab>({
    getTab: (tabId) => getTab(browser, tabId),
    findTab: (tabId) => browser.tabs.get(tabId),
    withDebugger: (webContents, operation) => withDebugger(browser, webContents, operation),
    allocationSampling: (tab) => Boolean(tab.memoryAllocation?.recording)
  })
}

/** Takes, lists, compares or clears a tab's heap snapshot summaries. */
export function heapSnapshots(browser: Browser, options: HeapSnapshotOptions): Promise<HeapSnapshotReport> {
  return browser.heapSnapshots.manage(options)
}
