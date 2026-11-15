import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('browser_steps runs several steps in one call and stops at the first that fails', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  await evaluate(`(() => {
    document.body.innerHTML = '<input id="name"><select id="size"><option value="s">Small</option><option value="l">Large</option></select>'
      + '<button id="add" onclick="document.body.dataset.added = String(Number(document.body.dataset.added || 0) + 1)">Add</button>'
      + '<input id="search">'
    document.querySelector('#search').addEventListener('keydown', (event) => { if (event.key === 'Enter') document.body.dataset.searched = event.target.value })
    return true
  })()`)

  const done = await call('browser_steps', {
    steps: [
      { action: 'type', selector: '#name', text: 'Ada' },
      { action: 'select', selector: '#size', value: 'l' },
      { action: 'click', selector: '#add' },
      { action: 'click', selector: '#add' },
      { action: 'wait', ms: 50 },
      { action: 'type', selector: '#search', text: 'shoes' },
      { action: 'press', key: 'Enter' }
    ]
  })
  expect(done.isError, text(done)).not.toBe(true)
  const report = JSON.parse(text(done)) as { completed: number; steps: Array<{ step: number; action: string }> }
  expect(report.completed).toBe(7)
  expect(report.steps.map(({ action }) => action)).toEqual(['type', 'select', 'click', 'click', 'wait', 'type', 'press'])
  expect(await evaluate(`({
    name: document.querySelector('#name').value,
    size: document.querySelector('#size').value,
    added: document.body.dataset.added,
    searched: document.body.dataset.searched
  })`)).toEqual({ name: 'Ada', size: 'l', added: '2', searched: 'shoes' })

  // The second step fails: the first stays done, and the rest never run.
  const failed = await call('browser_steps', {
    steps: [
      { action: 'click', selector: '#add' },
      { action: 'click', selector: '#missing' },
      { action: 'click', selector: '#add' }
    ]
  })
  expect(failed.isError).toBe(true)
  expect(text(failed)).toContain('Step 2 (click) failed')
  expect(failed.structuredContent).toMatchObject({ completed: 1, failedStep: 2 })
  expect(await evaluate('document.body.dataset.added')).toBe('3')

  // A key that pastes is refused before anything runs.
  const paste = await call('browser_steps', { steps: [{ action: 'click', selector: '#add' }, { action: 'press', key: 'Control+V' }] })
  expect(paste.isError).toBe(true)
  expect(await evaluate('document.body.dataset.added')).toBe('3')
})
