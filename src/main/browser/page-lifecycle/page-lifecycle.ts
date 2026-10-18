import type { BrowserPageLifecycleResult, BrowserPageLifecycleState, BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { PageLifecycleAccess, PageLifecycleTab } from './page-lifecycle-access.js'

const PAGE_LIFECYCLE_COMMAND_TIMEOUT_MS = 5_000

const HOLD_PAGE_ANIMATIONS_SCRIPT = `(() => {
  try {
    return Array.from(document.getAnimations()).slice(0, 10000).map(animation => {
      const record = {
        currentTime: animation.currentTime,
        playbackRate: animation.playbackRate
      };
      animation.playbackRate = 0;
      return record;
    });
  } catch { return []; }
})()`

/**
 * Reports the tab's page lifecycle state without changing it, with the next
 * step to take when an earlier command's outcome is unknown.
 */
export function pageLifecycle<Tab extends PageLifecycleTab>(access: PageLifecycleAccess<Tab>, tabId: string): BrowserPageLifecycleResult {
  const tab = access.getTab(tabId)
  return {
    tabId: tab.id,
    state: tab.pageLifecycleState,
    status: tab.pageLifecycleState === 'unknown' ? 'outcome-unknown' : 'unchanged',
    navigationGeneration: tab.navigationGeneration,
    retrySafe: tab.pageLifecycleState !== 'unknown',
    ...(tab.pageLifecycleState === 'unknown' ? {
      nextAction: 'Do not repeat the ambiguous command. Explicitly request the opposite lifecycle state, or navigate/reload to establish a fresh active document.'
    } : {})
  }
}

/** Freezes or resumes the tab's page for the person, then returns the browser state. */
export async function setTabPageLifecycle<Tab extends PageLifecycleTab>(
  access: PageLifecycleAccess<Tab>,
  tabId: string,
  state: Exclude<BrowserPageLifecycleState, 'unknown'>
): Promise<BrowserState> {
  await controlPageLifecycle(access, tabId, state)
  return access.getState()
}

/**
 * Freezes or resumes the tab's page. A request for the state already pending
 * joins that command; a request for the other state waits for it first. A
 * command whose outcome Chromium did not confirm leaves the state unknown
 * rather than retrying.
 */
export async function controlPageLifecycle<Tab extends PageLifecycleTab>(
  access: PageLifecycleAccess<Tab>,
  tabId: string,
  requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
): Promise<BrowserPageLifecycleResult> {
  const tab = access.getTab(tabId)
  tab.nativeInputEnvironmentGeneration += 1
  if (isHronautHomeUrl(tab.url)) throw new Error('Only live page tabs can be frozen or resumed.')
  if (tab.sleeping || tab.wakePromise) throw new Error('Wake the sleeping tab before changing its page lifecycle.')
  if (tab.webContents.isDestroyed()) throw new Error('The tab renderer is unavailable.')
  const pending = tab.pageLifecycleOperation
  if (pending) {
    if (pending.requestedState === requestedState) return pending.promise
    await pending.promise
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()) throw new Error('The tab closed while changing its page lifecycle.')
    return controlPageLifecycle(access, tab.id, requestedState)
  }
  if (tab.pageLifecycleState === requestedState) {
    return {
      tabId: tab.id,
      requestedState,
      state: requestedState,
      status: 'unchanged',
      navigationGeneration: tab.navigationGeneration,
      retrySafe: true
    }
  }
  if (tab.pageLifecycleState === 'unknown' && tab.pageLifecycleUnknownRequest === requestedState) {
    return {
      tabId: tab.id,
      requestedState,
      state: 'unknown',
      status: 'outcome-unknown',
      navigationGeneration: tab.navigationGeneration,
      retrySafe: false,
      nextAction: 'Do not repeat the ambiguous command. Explicitly request the opposite lifecycle state, or navigate/reload to establish a fresh active document.'
    }
  }
  const operation = controlPageLifecycleInternal(access, tab, requestedState)
  tab.pageLifecycleOperation = { requestedState, promise: operation }
  try {
    return await operation
  } finally {
    if (tab.pageLifecycleOperation?.promise === operation) tab.pageLifecycleOperation = undefined
  }
}

/**
 * Sends one lifecycle command through the tab's debugger queue. A freeze holds
 * the page's animations first and a resume restores them. A command that timed
 * out or failed after dispatch, or whose document changed, leaves the state
 * unknown.
 */
async function controlPageLifecycleInternal<Tab extends PageLifecycleTab>(
  access: PageLifecycleAccess<Tab>,
  tab: Tab,
  requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
): Promise<BrowserPageLifecycleResult> {
  const navigationGeneration = tab.navigationGeneration
  const webContents = tab.webContents
  let dispatched = false
  const assertCurrentDocument = (): void => {
    if (access.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()) {
      throw new Error('The tab closed before its page lifecycle command was dispatched.')
    }
    if (tab.navigationGeneration !== navigationGeneration) {
      throw new Error('The document changed before its page lifecycle command was dispatched.')
    }
  }
  const command = access.inDebuggerQueue(webContents.id, async () => {
    assertCurrentDocument()
    await access.dialogMonitorAttach(webContents.id)
    if (access.isDevToolsOpening(webContents.id) || webContents.isDevToolsOpened()) {
      throw new Error('Close Developer Tools for this tab before changing its page lifecycle.')
    }
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3')
      await webContents.debugger.sendCommand('Page.enable')
    }
    // Queueing and debugger attachment may outlive the requested document.
    assertCurrentDocument()
    if (requestedState === 'frozen') {
      dispatched = true
      let records: unknown = []
      try { records = await webContents.executeJavaScript(HOLD_PAGE_ANIMATIONS_SCRIPT, false) } catch { /* best effort */ }
      const validRecords = Array.isArray(records) && records.length <= 10_000 && !records.some(record => {
        if (!record || typeof record !== 'object') return true
        const candidate = record as { currentTime?: unknown; playbackRate?: unknown }
        return (candidate.currentTime !== null && (
          typeof candidate.currentTime !== 'number' || !Number.isFinite(candidate.currentTime)
        )) || typeof candidate.playbackRate !== 'number' || !Number.isFinite(candidate.playbackRate)
      })
      const animationRecords = validRecords ? records as unknown[] : []
      tab.pageLifecycleAnimations = animationRecords.map(record => ({
        currentTime: (record as { currentTime: number | null }).currentTime,
        playbackRate: (record as { playbackRate: number }).playbackRate
      }))
      await webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' })
    } else {
      dispatched = true
      await webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
      const records = tab.pageLifecycleAnimations ?? []
      const backgroundThrottling = webContents.getBackgroundThrottling()
      if (backgroundThrottling) webContents.setBackgroundThrottling(false)
      try {
        await new Promise(resolve => setTimeout(resolve, 34))
        await webContents.executeJavaScript(`(() => {
            try {
              const records = ${JSON.stringify(records)};
              const animations = Array.from(document.getAnimations());
              for (let index = 0; index < records.length; index += 1) {
                const animation = animations[index];
                if (!animation) continue;
                animation.playbackRate = records[index].playbackRate;
                animation.currentTime = records[index].currentTime;
              }
            } catch { /* Animation restoration is best effort for adversarial pages. */ }
          })()`, false)
      } finally {
        if (backgroundThrottling) webContents.setBackgroundThrottling(true)
      }
      tab.pageLifecycleAnimations = undefined
    }
  })
  const deadline = Symbol('page-lifecycle-command-timeout')
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<typeof deadline>((resolve) => {
    timer = setTimeout(() => resolve(deadline), PAGE_LIFECYCLE_COMMAND_TIMEOUT_MS)
    timer.unref()
  })
  const settled = command.then(
    () => ({ kind: 'completed' as const }),
    (error: unknown) => ({ kind: 'failed' as const, error })
  )
  const outcome = await Promise.race([settled, timeout])
  if (timer) clearTimeout(timer)
  if (outcome === deadline || (outcome.kind === 'failed' && dispatched)) {
    if (access.findTab(tab.id) === tab) {
      tab.pageLifecycleState = 'unknown'
      tab.pageLifecycleUnknownRequest = requestedState
      access.changed(false)
    }
    return {
      tabId: tab.id,
      requestedState,
      state: 'unknown',
      status: 'outcome-unknown',
      navigationGeneration: tab.navigationGeneration,
      retrySafe: false,
      nextAction: 'The command may have reached Chromium. Do not repeat it automatically; explicitly request the opposite state, or navigate/reload to establish a fresh active document.'
    }
  }
  if (outcome.kind === 'failed') throw outcome.error
  if (
    access.findTab(tab.id) !== tab
    || webContents.isDestroyed()
    || tab.navigationGeneration !== navigationGeneration
  ) {
    if (access.findTab(tab.id) === tab) {
      tab.pageLifecycleState = 'unknown'
      tab.pageLifecycleUnknownRequest = requestedState
      access.changed(false)
    }
    return {
      tabId: tab.id,
      requestedState,
      state: 'unknown',
      status: 'outcome-unknown',
      navigationGeneration: tab.navigationGeneration,
      retrySafe: false,
      nextAction: 'The document changed while Chromium applied the command. Inspect the current tab and navigate/reload if a fresh active document is required.'
    }
  }
  tab.pageLifecycleState = requestedState
  tab.pageLifecycleUnknownRequest = undefined
  access.changed(false)
  if (requestedState === 'active') access.reconcileTabPresentation(tab)
  return {
    tabId: tab.id,
    requestedState,
    state: requestedState,
    status: 'changed',
    navigationGeneration,
    retrySafe: true
  }
}
