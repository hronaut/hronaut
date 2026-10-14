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
export function installRightClickGate({ webContents }: typeof import('electron'), { url, cleanup }: { url: string; cleanup: boolean }): void {
  const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
  const original = page.debugger.sendCommand
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const allowed = new Set(['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate', 'Runtime.callFunctionOn',
    'DOM.describeNode', 'Input.setIgnoreInputEvents', 'Input.dispatchMouseEvent', 'Page.getLayoutMetrics', 'Runtime.releaseObjectGroup'])
  let nextCommand = 0
  const record = (stage: string, method?: string, command?: number): void => {
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
      page.debugger.removeListener('message', message)
      if (!page.isDestroyed()) page.debugger.sendCommand = original
    }
  }
  ;(globalThis as RightClickScope).rightClickGate = gate
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
}

export function rightClickSettlement(result: CallToolResult): Record<string, unknown> {
  const data = result.structuredContent
  const status = ['NOT_DISPATCHED', 'OUTCOME_UNKNOWN', 'POLICY_REJECTED', 'TIMED_OUT', 'STALE_PRECONDITION', 'BUSY', 'LEASE_LOST'].find(value => value === data?.status)
  const reason = ['CONTEXT_OR_INPUT_UNCERTAIN', 'TARGET_UNAVAILABLE', 'TARGET_CHANGED', 'TARGET_DISABLED',
    'TARGET_CLEANUP_UNCONFIRMED', 'NATIVE_INPUT_CLEANUP_FAILED', 'CLICK_STATE_UNCONFIRMED'].find(value => value === data?.reason)
  return { at: Date.now(), state: 'fulfilled', isError: result.isError === true,
    ...(status ? { status } : {}), ...(reason ? { reason } : {}) }
}
