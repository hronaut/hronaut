import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('rejects malformed recorder actions without stopping an active recording', async ({ appWindow }) => {
  const tabId = await appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'data:text/html,<title>Action validation</title><button>Record</button>', active: true })
    return state.activeTabId!
  })
  await expect.poll(() => appWindow.evaluate(async id => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return state.tabs.find(tab => tab.id === id)?.loading
  }, tabId)).toBe(false)
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', id), tabId)
  for (const action of ['get', 'start', 'clear', 'stop']) {
    const result = await appWindow.evaluate(async ({ tabId, action }) => {
      try {
        // Runtime IPC inputs must be validated even when a caller bypasses TypeScript.
        await (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro([action] as unknown as 'get', tabId)
        return { rejected: false, error: '' }
      } catch (error) {
        return { rejected: true, error: String(error) }
      }
    }, { tabId, action })
    expect(result.rejected).toBe(true)
    expect(result.error).toContain('Invalid repro recording options')
    expect(await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', id), tabId)).toMatchObject({ active: true, stepCount: 1 })
  }
  expect(await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', id), tabId)).toMatchObject({ active: false, stepCount: 1 })
})
