import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// A page that asks before it is left, as an editor with unsaved changes does, kept itself open when an agent or a
// person loaded another address, and nothing said so: browser_navigate reported success and the address bar did
// nothing. Chrome asks "Leave site?".

type LeaveDialogControl = { original: Electron.Dialog['showMessageBox']; responses: number[]; calls: Electron.MessageBoxOptions[] }

test('a page that asks before it is left stops browser_navigate with an error and asks a person', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  // As JSON, since browser_evaluate gives a string result as it is.
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const start = `${fixtureOrigin}/?leave=draft`
  const destination = `${fixtureOrigin}/no-js`
  const opened = await call('browser_navigate', { url: start })
  expect(opened.isError, text(opened)).not.toBe(true)
  await evaluate(`(() => {
    document.body.innerHTML = '<input id="draft">'
    addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    return true
  })()`)
  // A page may ask only once it was used, as by a click.
  const clicked = await call('browser_click', { selector: '#draft' })
  expect(clicked.isError, text(clicked)).not.toBe(true)
  // Keep Playwright from also dismissing the page's question, which would race Electron's own handling.
  for (const page of electronApp.context().pages()) page.on('dialog', () => undefined)

  const navigated = await call('browser_navigate', { url: destination })
  expect(navigated.isError).toBe(true)
  expect(text(navigated)).toContain('The page asked to confirm before it is left')
  expect(text(navigated)).toContain('so it stayed open and nothing was loaded')
  expect(await evaluate('location.href')).toBe(start)

  await electronApp.evaluate(({ dialog, webContents }, start) => {
    const control: LeaveDialogControl = { original: dialog.showMessageBox.bind(dialog), responses: [0, 1], calls: [] }
    ;(globalThis as typeof globalThis & { __leaveDialog?: LeaveDialogControl }).__leaveDialog = control
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async (...args: unknown[]) => {
        control.calls.push(args.at(-1) as Electron.MessageBoxOptions)
        const response = control.responses.shift() ?? 0
        // As an editor's autosave while the question is open, the page changes its address within itself.
        if (response === 1) {
          const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === start)
          await page?.executeJavaScript(`history.replaceState(null, '', location.href + '&saved=1')`, false)
        }
        return { response, checkboxChecked: false }
      }
    })
  }, start)
  try {
    const personNavigates = () => appWindow.evaluate(`window.hronaut.navigate(${JSON.stringify({ url: destination, tabId })}).then(() => true)`)
    // Keeping the page leaves it as it was.
    await personNavigates()
    expect(await evaluate('location.href')).toBe(start)
    // Leaving loads the address, even after the page changed its address within itself.
    await personNavigates()
    await expect.poll(() => evaluate('location.href')).toBe(destination)
    expect(await electronApp.evaluate(() => {
      const calls = (globalThis as typeof globalThis & { __leaveDialog?: LeaveDialogControl }).__leaveDialog?.calls ?? []
      return calls.map((options) => ({ title: options.title, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId }))
    })).toEqual([
      { title: 'Leave this page?', buttons: ['Keep editing', 'Leave page'], defaultId: 0, cancelId: 0 },
      { title: 'Leave this page?', buttons: ['Keep editing', 'Leave page'], defaultId: 0, cancelId: 0 }
    ])
  } finally {
    await electronApp.evaluate(({ dialog }) => {
      const scope = globalThis as typeof globalThis & { __leaveDialog?: LeaveDialogControl }
      if (scope.__leaveDialog) Object.defineProperty(dialog, 'showMessageBox', { configurable: true, value: scope.__leaveDialog.original })
      delete scope.__leaveDialog
    })
  }
})
