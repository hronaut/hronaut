import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { WorkerEvaluations } from './worker-evaluation.js'

/** Evaluations in the workers of the browser's tabs, through Hronaut's own DevTools session on each page. */
export function createWorkerEvaluations(browser: Browser): WorkerEvaluations<BrowserTab> {
  return new WorkerEvaluations<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation)
  })
}
