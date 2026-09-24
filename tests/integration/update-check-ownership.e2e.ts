import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

interface UpdateProbe {
  reads: number
  helpers: number
  quits: number
  release(): void
  restore(): void
}
type ProbeGlobal = typeof globalThis & { __updateOwnershipProbe?: UpdateProbe }

const updateTest = test.extend({
  profileDirectory: async ({ profileDirectory }, use) => {
    await writeFile(join(profileDirectory, 'settings.json'), JSON.stringify({ checkForUpdatesOnStartup: false }))
    await use(profileDirectory)
  }
})

updateTest('owns an update check before reading a replaced package and schedules one restart', async ({ appWindow, electronApp }) => {
  test.skip(process.platform !== 'linux', 'Package replacement restart detection is Linux-specific')
  await electronApp.evaluate(({ app, BrowserWindow }) => {
    const modules = process.getBuiltinModule('module')
    const fs = process.getBuiltinModule('fs/promises')
    const childProcess = process.getBuiltinModule('child_process')
    const { EventEmitter } = process.getBuiltinModule('events')
    const manifest = process.getBuiltinModule('path').join(app.getAppPath(), 'package.json')
    const readFile = fs.readFile
    const spawn = childProcess.spawn
    const packaged = Object.getOwnPropertyDescriptor(app, 'isPackaged')!
    const quit = app.quit
    const disabled = process.env.HRONAUT_DISABLE_AUTO_UPDATE
    const pending: Array<(value: string) => void> = []
    const probe: UpdateProbe = {
      reads: 0, helpers: 0, quits: 0,
      release: () => { for (const resolve of pending.splice(0)) resolve('{"version":"99.0.0"}') },
      restore: () => {
        Object.defineProperty(fs, 'readFile', { value: readFile })
        Object.defineProperty(childProcess, 'spawn', { value: spawn })
        Object.defineProperty(app, 'isPackaged', packaged)
        app.quit = quit
        if (disabled === undefined) delete process.env.HRONAUT_DISABLE_AUTO_UPDATE
        else process.env.HRONAUT_DISABLE_AUTO_UPDATE = disabled
        modules.syncBuiltinESMExports()
      }
    }
    Object.defineProperty(fs, 'readFile', { value: (path: unknown, ...args: unknown[]) => {
      if (String(path) !== manifest) return Reflect.apply(readFile, fs, [path, ...args])
      probe.reads++
      return new Promise<string>(resolve => pending.push(resolve))
    } })
    Object.defineProperty(childProcess, 'spawn', { value: (command: unknown, ...args: unknown[]) => {
      if (command !== '/bin/sh' || !Array.isArray(args[0]) || !args[0].includes('hronaut-update-relaunch')) {
        return Reflect.apply(spawn, childProcess, [command, ...args])
      }
      probe.helpers++
      return Object.assign(new EventEmitter(), { unref: () => undefined })
    } })
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
    delete process.env.HRONAUT_DISABLE_AUTO_UPDATE
    app.quit = () => {
      probe.quits++
      for (const window of BrowserWindow.getAllWindows()) window.show()
    }
    modules.syncBuiltinESMExports()
    ;(globalThis as ProbeGlobal).__updateOwnershipProbe = probe
  })
  try {
    await appWindow.evaluate(`(() => {
      window.__updateCheckCompletions = 0;
      const check = () => window.hronautUpdates.check().finally(() => window.__updateCheckCompletions++);
      window.__updateChecks = Promise.all([check(), check()]);
    })()`)
    // The second check must either reach the held read (old behavior) or finish
    // immediately under the first check's ownership. No timing-only barrier.
    await expect.poll(async () => {
      const reads = await electronApp.evaluate(() => (globalThis as ProbeGlobal).__updateOwnershipProbe!.reads)
      return reads >= 2 || Number(await appWindow.evaluate('window.__updateCheckCompletions')) > 0
    }).toBe(true)
    await electronApp.evaluate(() => (globalThis as ProbeGlobal).__updateOwnershipProbe!.release())
    await appWindow.evaluate('window.__updateChecks')
    expect(await electronApp.evaluate(() => {
      const { reads, helpers, quits } = (globalThis as ProbeGlobal).__updateOwnershipProbe!
      return { reads, helpers, quits }
    })).toEqual({ reads: 1, helpers: 1, quits: 1 })
  } finally {
    await electronApp.evaluate(() => {
      const probe = (globalThis as ProbeGlobal).__updateOwnershipProbe
      probe?.release()
      probe?.restore()
      delete (globalThis as ProbeGlobal).__updateOwnershipProbe
    })
  }
})
