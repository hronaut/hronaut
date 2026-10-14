import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type RightClickGate = {
  held: boolean
  commands: string[]
  events: Array<{ at: number; stage: string; method?: string; command?: number }>
  dropped: number
  release(): void
  restore(): void
}
export type RightClickScope = typeof globalThis & { rightClickGate?: RightClickGate }

// This function is serialized into Electron's main process. Keep it self-contained.
// Record method categories only: never parameters, results, URLs or error text.
export function installRightClickGate({ webContents, BrowserWindow, screen }: typeof import('electron'), { url, cleanup }: { url: string; cleanup: boolean }): void {
  const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
  const original = page.debugger.sendCommand
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const allowed = new Set(['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate', 'Runtime.callFunctionOn',
    'DOM.describeNode', 'Input.setIgnoreInputEvents', 'Input.dispatchMouseEvent', 'Page.getLayoutMetrics', 'Runtime.releaseObjectGroup'])
  const restorers: Array<() => void> = []
  let closed = false
  let nextCommand = 0
  const record = (stage: string, method?: string, command?: number): void => {
    if (closed) return
    if (gate.events.length >= 128) { gate.dropped++; return }
    gate.events.push({ at: Date.now(), stage, ...(method ? { method } : {}), ...(command !== undefined ? { command } : {}) })
  }
  const message = (_event: unknown, method: string): void => {
    if (['Page.frameResized', 'Page.frameAttached', 'Page.frameDetached'].includes(method)) record('notification', method)
  }
  const gate: RightClickGate = {
    held: false, commands: [], events: [], dropped: 0,
    release: () => { record('gate-release'); release() },
    restore: () => {
      release()
      closed = true
      let failed = false
      let failure: unknown
      // Continue restoring independent hooks even if one native wrapper rejects
      // assignment during teardown. A caller may retry restoration afterward.
      for (const restore of [...restorers].reverse()) {
        try { restore() } catch (error) { if (!failed) { failed = true; failure = error } }
      }
      if (failed) throw failure
    }
  }
  ;(globalThis as RightClickScope).rightClickGate = gate
  restorers.push(() => { if (!page.isDestroyed()) page.debugger.sendCommand = original })
  restorers.push(() => { page.debugger.removeListener('message', message) })
  try {
    // Observe the original promises without adding an awaited stage or retaining
    // script text, return values, arguments, errors, or arbitrary world identifiers.
    const observe = <T>(category: string, operation: () => Promise<T>): Promise<T> => {
      const command = ++nextCommand
      record('invoke', category, command)
      let pending: Promise<T>
      try { pending = operation() } catch (error) { record('throw', category, command); throw error }
      void pending.then(() => record('resolve', category, command), () => record('reject', category, command))
      return pending
    }
    const javascript = page.executeJavaScript
    restorers.push(() => { page.executeJavaScript = javascript })
    page.executeJavaScript = (...args) => observe('executeJavaScript', () => javascript.apply(page, args))
    const isolated = page.executeJavaScriptInIsolatedWorld
    restorers.push(() => { page.executeJavaScriptInIsolatedWorld = isolated })
    page.executeJavaScriptInIsolatedWorld = (...args) => observe(args[0] === 1010 ? 'isolated.visibility-probe'
      : args[0] === 1013 ? 'isolated.agent-pointer' : 'isolated.other', () => isolated.apply(page, args))
    const native = page as typeof page & { setEmbedder?: (embedder: Electron.WebContents) => void }
    const embedder = native.setEmbedder
    if (embedder) {
      restorers.push(() => { native.setEmbedder = embedder })
      native.setEmbedder = (...args) => {
        const command = ++nextCommand
        record('invoke', 'setEmbedder', command)
        try { const result = embedder.apply(page, args); record('return', 'setEmbedder', command); return result }
        catch (error) { record('throw', 'setEmbedder', command); throw error }
      }
    }
    const owner = BrowserWindow.getAllWindows().find(window => window.contentView.children.some(view => 'webContents' in view && view.webContents === page))
    const view = owner?.contentView.children.find(view => 'webContents' in view && view.webContents === page)
    if (view) {
      const bounds = view.setBounds
      restorers.push(() => { view.setBounds = bounds })
      view.setBounds = (...args) => {
        const command = ++nextCommand
        record('invoke', 'view.setBounds', command)
        try { const result = bounds.apply(view, args); record('return', 'view.setBounds', command); return result }
        catch (error) { record('throw', 'view.setBounds', command); throw error }
      }
      const visible = view.setVisible
      restorers.push(() => { view.setVisible = visible })
      view.setVisible = (...args) => {
        const command = ++nextCommand
        record('invoke', 'view.setVisible', command)
        try { const result = visible.apply(view, args); record('return', 'view.setVisible', command); return result }
        catch (error) { record('throw', 'view.setVisible', command); throw error }
      }
    }
    const listen = (target: NodeJS.EventEmitter, name: string, category: string): void => {
      const listener = (): void => record('notification', category)
      restorers.push(() => { target.removeListener(name, listener) })
      target.on(name, listener)
    }
    for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'zoom-changed', 'frame-created', 'devtools-opened', 'destroyed']) listen(page, name, `page.${name}`)
    listen(page.debugger, 'detach', 'debugger.detach')
    listen(screen, 'display-metrics-changed', 'screen.display-metrics-changed')
    if (view) listen(view, 'bounds-changed', 'view.bounds-changed')
    if (owner) for (const name of ['move', 'hide', 'minimize']) listen(owner, name, `window.${name}`)
    page.debugger.on('message', message)
    page.debugger.sendCommand = async (method, ...args) => {
      const category = allowed.has(method) ? method : 'other'
      // Immediately precedes the original call, not just entry into a waiting hook.
      const command = ++nextCommand
      record('invoke', category, command)
      if (method === 'Input.dispatchMouseEvent') gate.commands.push(String((args[0] as Record<string, unknown>)?.type))
      let result: unknown
      try { result = await original.call(page.debugger, method, ...args) }
      catch (error) { record('reject', category, command); throw error }
      record('resolve', category, command)
      if (method === (cleanup ? 'Runtime.releaseObjectGroup' : 'Page.getLayoutMetrics') && !gate.held) {
        gate.held = true
        record('gate-held', category, command)
        await hold
      }
      return result
    }
  } catch (error) {
    try { gate.restore() } catch { /* Preserve the original setup failure after attempting every rollback. */ }
    if ((globalThis as RightClickScope).rightClickGate === gate) delete (globalThis as RightClickScope).rightClickGate
    throw error
  }
}

export function rightClickSettlement(result: CallToolResult): Record<string, unknown> {
  const data = result.structuredContent
  const status = ['NOT_DISPATCHED', 'OUTCOME_UNKNOWN', 'POLICY_REJECTED', 'TIMED_OUT', 'STALE_PRECONDITION', 'BUSY', 'LEASE_LOST'].find(value => value === data?.status)
  const reason = ['CONTEXT_OR_INPUT_UNCERTAIN', 'TARGET_UNAVAILABLE', 'TARGET_CHANGED', 'TARGET_DISABLED',
    'TARGET_CLEANUP_UNCONFIRMED', 'NATIVE_INPUT_CLEANUP_FAILED', 'CLICK_STATE_UNCONFIRMED'].find(value => value === data?.reason)
  const preflight = [
    ['Right-click environment changed; inspect fresh state without replay', 'environment-changed'],
    ['Right-click requires the active visible, already awake page outside split view', 'presentation-required'],
    ['Right-click requires a page locked in the trusted UI', 'lock-required'],
    ['Right-click does not support pages containing child frames', 'child-frame-unsupported'],
    ['Right-click is unavailable during native selection or Developer Tools', 'native-selection-or-devtools'],
    ['Right-click requires default zoom, no emulation overrides, and display scale 1', 'default-geometry-required']
  ].find(([message]) => result.isError === true && result.content.some(item => item.type === 'text' && item.text === message))?.[1]
  return { at: Date.now(), state: 'fulfilled', isError: result.isError === true,
    ...(status ? { status } : {}), ...(reason ? { reason } : {}), ...(preflight ? { preflight } : {}) }
}
