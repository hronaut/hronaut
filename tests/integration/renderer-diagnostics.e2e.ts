import { collectRendererDiagnostics, expect, test } from './fixtures.js'

type BusyShellScope = typeof globalThis & { __shellBusy?: boolean }
type Diagnostics = { nativeContents: { id: number; answered?: boolean }[] }

test('failure diagnostics tell a busy shell renderer from the pages that still answer', async ({ electronApp, appWindow }) => {
  const shellId = await electronApp.evaluate(({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows()[0]!.webContents
    ;(globalThis as BusyShellScope).__shellBusy = false
    shell.on('console-message', event => { if (event.message === 'synthetic-shell-busy') (globalThis as BusyShellScope).__shellBusy = true })
    return shell.id
  })
  // Holds the shell's main thread, as a loop in its own code would, once it has said so.
  const busy = appWindow.evaluate(`(function holdShellForDiagnostics() {
    console.log('synthetic-shell-busy')
    const end = Date.now() + 6000
    while (Date.now() < end);
  })()`)
  await expect.poll(() => electronApp.evaluate(() => (globalThis as BusyShellScope).__shellBusy)).toBe(true)
  const diagnostics = await collectRendererDiagnostics(electronApp) as Diagnostics
  await busy
  const shell = diagnostics.nativeContents.find(contents => contents.id === shellId)
  expect(shell?.answered).toBe(false)
  expect(diagnostics.nativeContents.some(contents => contents.id !== shellId && contents.answered === true)).toBe(true)
})
