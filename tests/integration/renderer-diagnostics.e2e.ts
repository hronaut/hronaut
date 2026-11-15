import { collectRendererDiagnostics, expect, test } from './fixtures.js'

type BusyShellScope = typeof globalThis & { __shellBusy?: { seen: boolean; stop(): void } }
type Diagnostics = { nativeContents?: { id: number; script?: string }[] }

test('failure diagnostics tell a busy shell renderer from the pages that still answer', async ({ electronApp, appWindow }) => {
  // Home answers scripts once it has loaded, as every tab page does.
  const homeId = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!.id)
  await expect.poll(() => electronApp.evaluate(({ webContents }, id) => !webContents.fromId(id)!.isLoadingMainFrame(), homeId)).toBe(true)
  const shellId = await electronApp.evaluate(({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows()[0]!.webContents
    const probe = { seen: false, stop: () => { shell.off('console-message', listener) } }
    const listener = (event: { message: string }) => { if (event.message === 'synthetic-shell-busy') probe.seen = true }
    shell.on('console-message', listener)
    ;(globalThis as BusyShellScope).__shellBusy = probe
    return shell.id
  })
  try {
    // Holds the shell's main thread, as a loop in its own code would, once it has said so.
    const busy = appWindow.evaluate(`(function holdShellForDiagnostics() {
      console.log('synthetic-shell-busy')
      const end = Date.now() + 6000
      while (Date.now() < end);
    })()`)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as BusyShellScope).__shellBusy!.seen)).toBe(true)
    const diagnostics = await collectRendererDiagnostics(electronApp) as Diagnostics
    await busy
    expect(diagnostics.nativeContents, JSON.stringify(diagnostics)).toBeDefined()
    expect(diagnostics.nativeContents!.find(contents => contents.id === shellId)?.script).toBe('silent')
    expect(diagnostics.nativeContents!.find(contents => contents.id === homeId)?.script).toBe('answered')
  } finally {
    await electronApp.evaluate(() => {
      const scope = globalThis as BusyShellScope
      scope.__shellBusy?.stop()
      delete scope.__shellBusy
    })
  }
})
