import { expect, test } from './fixtures.js'

type LockRaceProbe = {
  release: () => void
  restore: () => void
  waiting: boolean
  ignored: boolean
}

for (const [firstScope, secondScope] of [['tab', 'tab'], ['global', 'global'], ['global', 'tab']] as const) {
  test(`preserves a newer ${secondScope} lock after a failed ${firstScope} lock`, async ({ appWindow, electronApp }) => {
    const url = 'data:text/html,' + encodeURIComponent('<title>Queued input lock</title><button>Action</button>')
    const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })
      .then((state) => state.activeTabId)`) as string
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)'))
      .toBe('Queued input lock')

    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Input lock queue fixture missing')
      const original = page.debugger.sendCommand.bind(page.debugger)
      const probe: LockRaceProbe = {
        release: () => undefined,
        restore: () => { Object.defineProperty(page.debugger, 'sendCommand', { configurable: true, value: original }) },
        waiting: false,
        ignored: false
      }
      ;(globalThis as unknown as { qaLockRace: LockRaceProbe }).qaLockRace = probe
      let failed = false
      Object.defineProperty(page.debugger, 'sendCommand', {
        configurable: true,
        value: async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
          if (method === 'Input.setIgnoreInputEvents' && params?.ignore === true && !failed) {
            failed = true
            await new Promise<void>(resolve => {
              probe.release = resolve
              probe.waiting = true
            })
            throw new Error('Synthetic queued lock failure')
          }
          const result = await original(method, params, sessionId)
          if (method === 'Input.setIgnoreInputEvents') probe.ignored = params?.ignore === true
          return result
        }
      })
    }, url)

    const call = (scope: string): string => scope === 'global'
        ? 'window.hronaut.setAllHumanInteractionLocked(true)'
        : `window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`
    const mutations = appWindow.evaluate(`Promise.allSettled([${call(firstScope)}, ${call(secondScope)}])
        .then(results => results.map(result => ({ status: result.status,
          error: result.status === 'rejected' ? String(result.reason) : null })))`)
    void mutations.catch(() => undefined)
    try {
      await expect.poll(() => electronApp.evaluate(() =>
        (globalThis as unknown as { qaLockRace: LockRaceProbe }).qaLockRace.waiting)).toBe(true)
      await electronApp.evaluate(() => (globalThis as unknown as { qaLockRace: LockRaceProbe }).qaLockRace.release())
      expect(await mutations).toEqual([
        { status: 'rejected', error: expect.stringContaining('Synthetic queued lock failure') },
        { status: 'fulfilled', error: null }
      ])
      const locked = await appWindow.evaluate(`window.hronaut.getState()
        .then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.humanInteractionInputLocked)`)
      expect(locked).toBe(true)
      expect(await electronApp.evaluate(() =>
        (globalThis as unknown as { qaLockRace: LockRaceProbe }).qaLockRace.ignored)).toBe(true)
    } finally {
      await electronApp.evaluate(() => {
        const holder = globalThis as unknown as { qaLockRace?: LockRaceProbe }
        holder.qaLockRace?.release()
        holder.qaLockRace?.restore()
        delete holder.qaLockRace
      })
      await mutations.catch(() => undefined)
    }
  })
}
