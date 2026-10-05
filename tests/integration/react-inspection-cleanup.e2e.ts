import type { ReactInspectionResult } from '../../src/shared/react-inspection.js'
import type { HronautApi } from '../../src/shared/types.js'
import { decode, expect, test } from './react-inspection-fixtures.js'

for (const recorder of ['browser_code_coverage', 'browser_cpu_profile'] as const) {
  test(`releases timed-out React handles before queued ${recorder} acquires the debugger`, async ({ react, electronApp, appWindow }) => {
    await react.enable()
    await react.holdRead()
    const read = react.react('tree')
    await react.entered()
    expect(decode<ReactInspectionResult>(await read).status).toBe('timed-out')
    let settled = false
    const start = react.call(recorder, { workspaceId: react.workspace.id, tabId: react.tabId, action: 'start', ...(recorder === 'browser_code_coverage' ? { reload: false } : {}) })
      .finally(() => { settled = true })
    try {
      await expect.poll(() => appWindow.evaluate(async ({ tabId, recorder }) => {
        const state = await (window as unknown as {hronaut: HronautApi}).hronaut.getState()
        const tab = state.tabs.find(tab => tab.id === tabId)
        return Boolean(recorder === 'browser_code_coverage' ? tab?.codeCoverageRecording : tab?.cpuProfileRecording)
      }, { tabId: react.tabId, recorder })).toBe(true)
      expect(settled).toBe(false)
      await react.release()
      await react.success(start)
      const released = await electronApp.evaluate(async ({ webContents }, id) => {
        const objectId = (globalThis as typeof globalThis & {__reactHold?: {objectId?: string}}).__reactHold?.objectId
        if (!objectId) throw new Error('Held React API handle was not captured')
        try {
          await webContents.fromId(id)!.debugger.sendCommand('Runtime.getProperties', { objectId })
          return false
        } catch { return true }
      }, react.contentsId)
      expect(released).toBe(true)
    } finally {
      await react.release()
      await start.catch(() => {})
      await react.call(recorder, { workspaceId: react.workspace.id, tabId: react.tabId, action: 'stop' })
    }
  })
}
