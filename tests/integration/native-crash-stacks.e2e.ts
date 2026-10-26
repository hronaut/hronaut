import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { nativeCrashStacks } from './native-crash-stacks.js'

// Renderers that crashed in e2e runs left only "crashed, exit code 139". Each launch now has Electron print a crashed
// process's native stack, which a failed test attaches as module+offset frames.

test('a page renderer that crashes leaves its native stack for a failed test to attach', async ({ appWindow, electronApp }, testInfo) => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Crash fixture</title>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/crash`
  try {
    await appWindow.evaluate(async (url) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.getState()
      await api.navigate({ tabId: state.activeTabId!, url })
    }, url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .some(contents => contents.getURL() === url && !contents.isLoading()), url)).toBe(true)
    expect(nativeCrashStacks(testInfo)).toEqual([])
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      process.kill(page.getOSProcessId(), 'SIGSEGV')
    }, url)
    await expect.poll(() => nativeCrashStacks(testInfo).find(stack => stack.signal.startsWith('11 '))?.frames
      .filter(frame => /^electron\+0x[0-9a-f]+$/.test(frame)).length ?? 0).toBeGreaterThan(2)
    // Module file names and offsets only, never a folder.
    expect(JSON.stringify(nativeCrashStacks(testInfo))).not.toContain('/')
  } finally {
    await closeFixtureServer(server)
  }
})
