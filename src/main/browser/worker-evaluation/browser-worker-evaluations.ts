import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { WorkerEvaluations } from './worker-evaluation.js'
import { getTab } from '../browser-core.js'
import type { WorkerEvaluationReport, WorkerListReport } from '../../../shared/worker-evaluation.js'
import type { WorkerEvaluationAuthority, WorkerEvaluationDeadline } from './worker-evaluation.js'

/** Evaluations in the workers of the browser's tabs, through Hronaut's own DevTools session on each page. */
export function createWorkerEvaluations(browser: Browser): WorkerEvaluations<BrowserTab> {
  return new WorkerEvaluations<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation)
  })
}

/** The workers running in a tab. */
export function listWorkers(browser: Browser, tabId: string, authority: WorkerEvaluationAuthority): Promise<WorkerListReport> {
  return browser.workerEvaluations.list(getTab(browser, tabId), authority)
}

/** Evaluates a script in one of a tab's workers. */
export function evaluateInWorker(browser: Browser, tabId: string, handle: string, script: string, deadline: WorkerEvaluationDeadline, authority: WorkerEvaluationAuthority): Promise<WorkerEvaluationReport> {
  return browser.workerEvaluations.evaluate(getTab(browser, tabId), handle, script, deadline, authority)
}
