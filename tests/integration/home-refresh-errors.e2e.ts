import { expect, test } from './fixtures.js'

interface RefreshProbe {
  attempts: number
  handled: number
  escaped: string | null
  finish(): void
  restore(): void
}

type ProbeGlobal = typeof globalThis & { __homeRefreshProbe?: RefreshProbe }

for (const deferred of [false, true]) {
  test(`handles ${deferred ? 'deferred' : 'immediate'} Home reload errors after committing MCP pause`, async ({ appWindow, electronApp }) => {
    await appWindow.evaluate('window.hronaut.openHome()')
    await expect.poll(() => electronApp.evaluate(({ webContents }) => {
      const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
      return home !== undefined && !home.isLoadingMainFrame()
    })).toBe(true)
    await electronApp.evaluate(({ webContents }, deferred) => {
      const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
      const reload = Object.getOwnPropertyDescriptor(home, 'reload')
      const loading = Object.getOwnPropertyDescriptor(home, 'isLoadingMainFrame')
      const originalError = console.error
      const probe: RefreshProbe = {
        attempts: 0,
        handled: 0,
        escaped: null,
        finish: () => {
          // Catch escaped event-handler exceptions in the test so a regression
          // cannot open Electron's blocking uncaught-exception dialog.
          try { home.emit('did-stop-loading') } catch (error) {
            probe.escaped = error instanceof Error ? error.message : String(error)
          }
        },
        restore: () => {
          if (reload) Object.defineProperty(home, 'reload', reload)
          else Reflect.deleteProperty(home, 'reload')
          if (loading) Object.defineProperty(home, 'isLoadingMainFrame', loading)
          else Reflect.deleteProperty(home, 'isLoadingMainFrame')
          console.error = originalError
        }
      }
      Object.defineProperty(home, 'isLoadingMainFrame', { configurable: true, value: () => deferred })
      Object.defineProperty(home, 'reload', { configurable: true, value: () => {
        probe.attempts++
        throw new Error('Controlled Home refresh failure')
      } })
      console.error = (...args: unknown[]) => {
        if (args.some(value => value instanceof Error && value.message === 'Controlled Home refresh failure')) probe.handled++
        else originalError(...args)
      }
      ;(globalThis as ProbeGlobal).__homeRefreshProbe = probe
    }, deferred)
    try {
      expect(await appWindow.evaluate('window.hronautMcp.setPaused(true)')).toMatchObject({ paused: true })
      if (deferred) {
        expect(await electronApp.evaluate(() => (globalThis as ProbeGlobal).__homeRefreshProbe!.attempts)).toBe(0)
        await electronApp.evaluate(() => (globalThis as ProbeGlobal).__homeRefreshProbe!.finish())
      }
      expect(await electronApp.evaluate(() => (globalThis as ProbeGlobal).__homeRefreshProbe!.escaped)).toBeNull()
      await expect.poll(() => electronApp.evaluate(() => {
        const probe = (globalThis as ProbeGlobal).__homeRefreshProbe!
        return { attempts: probe.attempts, handled: probe.handled }
      })).toEqual({ attempts: 1, handled: 1 })
      expect(await appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ paused: true })
    } finally {
      await electronApp.evaluate(() => {
        ;(globalThis as ProbeGlobal).__homeRefreshProbe?.restore()
        delete (globalThis as ProbeGlobal).__homeRefreshProbe
      })
      await appWindow.evaluate('window.hronautMcp.setPaused(false)')
    }
  })
}
