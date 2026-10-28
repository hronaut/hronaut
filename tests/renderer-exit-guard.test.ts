import { describe, expect, it, vi } from 'vitest'
import { firstLoadStarts, guardPageCallsAcrossRendererExit, holdUntilFirstLoad, RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'

function deferred(): { promise: Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void } {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function fakePage() {
  const gone: Array<() => void> = []
  const state = { crashed: false, destroyed: false }
  const calls: Array<{ kind: string; args: unknown[]; reply: ReturnType<typeof deferred> }> = []
  const record = (kind: string) => (...args: unknown[]) => {
    if (state.destroyed) throw new TypeError('Object has been destroyed')
    const reply = deferred()
    calls.push({ kind, args, reply })
    return reply.promise
  }
  const page = {
    isDestroyed: () => state.destroyed,
    isCrashed: () => state.crashed,
    on: (event: string, listener: () => void) => { if (event === 'render-process-gone') gone.push(listener) },
    executeJavaScript: record('script'),
    executeJavaScriptInIsolatedWorld: record('isolated'),
    capturePage: record('capture'),
    printToPDF: record('print'),
    debugger: { sendCommand: record('command') }
  }
  guardPageCallsAcrossRendererExit(page as never)
  const exit = (): void => { state.crashed = true; for (const listener of gone) listener() }
  const restart = (): void => { state.crashed = false }
  return { page, state, calls, exit, restart }
}

describe('page calls across a renderer exit', () => {
  it('rejects scripts, isolated-world scripts and commands in flight when the renderer exits', async () => {
    const { page, calls, exit } = fakePage()
    const script = page.executeJavaScript('1', true)
    const isolated = page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }], true)
    const command = page.debugger.sendCommand('Runtime.evaluate', { expression: '3' })
    exit()
    await expect(script).rejects.toMatchObject({ name: 'RendererExitedError', sent: true })
    await expect(isolated).rejects.toMatchObject({ name: 'RendererExitedError', sent: true })
    await expect(command).rejects.toThrow('effects are unknown')
    // Electron settles nothing late; if it did, the outcome is already reported.
    for (const call of calls) call.reply.reject(new Error('Target crashed'))
    await Promise.resolve()
  })

  // On Electron 45 an evaluation in flight whose renderer exited failed with "Render frame was disposed before the
  // request completed", since Electron rejects it before it reports the exit.
  it('reports a script that Electron rejects as its frame goes away as stopped by the renderer exit', async () => {
    vi.useFakeTimers()
    try {
      const disposed = () => new Error('Render frame was disposed before the request completed')
      const { page, state, calls, exit, restart } = fakePage()
      const beforeReport = page.executeJavaScript('1')
      calls[0]!.reply.reject(disposed())
      await vi.advanceTimersByTimeAsync(0)
      exit()
      await expect(beforeReport).rejects.toMatchObject({ name: 'RendererExitedError', sent: true })

      // The page already counts as crashed, though render-process-gone has not been emitted yet.
      restart()
      const crashedFirst = page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }])
      state.crashed = true
      calls[1]!.reply.reject(disposed())
      await expect(crashedFirst).rejects.toMatchObject({ name: 'RendererExitedError', sent: true })

      // A navigation replaced the document the script ran in, and no renderer exit is reported.
      restart()
      const navigated = page.executeJavaScript('3')
      const failed = page.executeJavaScript('4')
      const replaced = expect(navigated).rejects.toThrow('Render frame was disposed before the request completed')
      calls[2]!.reply.reject(disposed())
      calls[3]!.reply.reject(new Error('Script failed'))
      await expect(failed).rejects.toThrow('Script failed')
      await vi.advanceTimersByTimeAsync(100)
      await replaced
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a capture or a print in flight when the renderer exits, and refuses both unsent while it stays gone', async () => {
    const { page, calls, exit } = fakePage()
    const capture = page.capturePage()
    const print = page.printToPDF({})
    exit()
    await expect(capture).rejects.toMatchObject({ name: 'RendererExitedError', sent: true })
    await expect(print).rejects.toMatchObject({ name: 'RendererExitedError', sent: true })
    for (const call of calls) call.reply.reject(new Error('Target crashed'))
    calls.length = 0
    // Printing a page whose renderer exited ends the application, so it never reaches Electron.
    await expect(page.printToPDF({})).rejects.toMatchObject({ name: 'RendererExitedError', sent: false })
    await expect(page.capturePage({ x: 0, y: 0, width: 10, height: 10 })).rejects.toThrow('nothing was sent')
    expect(calls).toEqual([])
  })

  it('fails at once and unsent while the renderer stays gone, without reaching the page', async () => {
    const { page, calls, exit } = fakePage()
    exit()
    await expect(page.executeJavaScript('1')).rejects.toMatchObject({ name: 'RendererExitedError', sent: false })
    await expect(page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }])).rejects.toBeInstanceOf(RendererExitedError)
    await expect(page.debugger.sendCommand('Page.getFrameTree')).rejects.toThrow('nothing was sent')
    await expect(page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' })).rejects.toBeInstanceOf(RendererExitedError)
    expect(calls).toEqual([])
  })

  it('keeps commands the browser process answers working while the page is gone', async () => {
    const { page, calls, exit } = fakePage()
    const before = page.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: true })
    exit()
    const during = [
      page.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: false }),
      page.debugger.sendCommand('Fetch.continueRequest', { requestId: 'r1' }),
      page.debugger.sendCommand('Network.deleteCookies', { name: 'n', domain: 'example.test' }),
      page.debugger.sendCommand('Network.getAllCookies'),
      page.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }),
      // A virtual passkey survives the renderer, so it must stay removable.
      page.debugger.sendCommand('WebAuthn.disable'),
      // So does auto-attach to the page's workers, which would otherwise attach the new renderer's workers.
      page.debugger.sendCommand('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
    ]
    expect(calls.map(call => call.args)).toEqual([
      ['Input.setIgnoreInputEvents', { ignore: true }],
      ['Input.setIgnoreInputEvents', { ignore: false }],
      ['Fetch.continueRequest', { requestId: 'r1' }],
      ['Network.deleteCookies', { name: 'n', domain: 'example.test' }],
      ['Network.getAllCookies'],
      ['Page.setWebLifecycleState', { state: 'active' }],
      ['WebAuthn.disable'],
      ['Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }]
    ])
    for (const call of calls) call.reply.resolve({})
    await expect(before).resolves.toEqual({})
    await expect(Promise.all(during)).resolves.toEqual([{}, {}, {}, {}, {}, {}, {}])
  })

  it('lets calls through again for the next renderer, and guards them against its exit', async () => {
    const { page, calls, exit, restart } = fakePage()
    exit()
    restart()
    const settled = page.executeJavaScript('1')
    calls[0]!.reply.resolve(1)
    await expect(settled).resolves.toBe(1)
    const pending = page.debugger.sendCommand('DOM.getDocument')
    exit()
    await expect(pending).rejects.toBeInstanceOf(RendererExitedError)
  })

  it('passes arguments through unchanged and leaves results and failures alone', async () => {
    const { page, calls } = fakePage()
    const enabled = page.debugger.sendCommand('Page.enable')
    const evaluated = page.debugger.sendCommand('Runtime.evaluate', { expression: '1' }, 'session-1')
    const script = page.executeJavaScript('document.title', true)
    const isolated = page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }], true)
    void page.capturePage({ x: 1, y: 2, width: 3, height: 4 }, { stayHidden: true, stayAwake: false })
    void page.printToPDF({ landscape: true })
    expect(calls.map(call => [call.kind, ...call.args])).toEqual([
      ['command', 'Page.enable'],
      ['command', 'Runtime.evaluate', { expression: '1' }, 'session-1'],
      ['script', 'document.title', true],
      ['isolated', 7, [{ code: '2' }], true],
      ['capture', { x: 1, y: 2, width: 3, height: 4 }, { stayHidden: true, stayAwake: false }],
      ['print', { landscape: true }]
    ])
    // Hidden captures pass an explicit undefined rect, which must reach Electron as given.
    void page.capturePage(undefined, { stayHidden: true, stayAwake: false })
    expect(calls.at(-1)!.args).toStrictEqual([undefined, { stayHidden: true, stayAwake: false }])
    calls[0]!.reply.resolve({})
    calls[1]!.reply.resolve({ result: 1 })
    calls[2]!.reply.reject(new Error('Script failed'))
    calls[3]!.reply.resolve(2)
    await expect(enabled).resolves.toEqual({})
    await expect(evaluated).resolves.toEqual({ result: 1 })
    await expect(script).rejects.toThrow('Script failed')
    await expect(isolated).resolves.toBe(2)
  })

  // A tab restored asleep loads nothing and has no renderer until it wakes, and Electron held its page's calls until
  // then: locking every tab's input waited on it and failed as a busy page.
  it('refuses the calls of a page held until its first load at once and unsent, and lets them through as it starts', async () => {
    const { page, calls } = fakePage()
    holdUntilFirstLoad(page)
    await expect(page.executeJavaScript('1')).rejects.toMatchObject({ name: 'NotLoadedYetError', sent: false })
    await expect(page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }])).rejects.toBeInstanceOf(RendererExitedError)
    await expect(page.debugger.sendCommand('Page.enable')).rejects.toThrow('has not loaded its page yet')
    await expect(page.capturePage()).rejects.toBeInstanceOf(RendererExitedError)
    await expect(page.printToPDF({})).rejects.toBeInstanceOf(RendererExitedError)
    // The browser process answers the input barrier without a renderer.
    void page.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: true })
    expect(calls.map(call => call.args)).toEqual([['Input.setIgnoreInputEvents', { ignore: true }]])
    firstLoadStarts(page)
    void page.debugger.sendCommand('Page.enable')
    expect(calls.map(call => call.args).at(-1)).toEqual(['Page.enable'])
  })

  it('leaves calls that settled before an exit alone', async () => {
    const { page, calls, exit } = fakePage()
    const settled = page.executeJavaScript('1')
    calls[0]!.reply.resolve(1)
    await expect(settled).resolves.toBe(1)
    exit()
    await expect(settled).resolves.toBe(1)
  })

  it('leaves a destroyed page to fail as Electron fails it', () => {
    const { page, state } = fakePage()
    state.destroyed = true
    const crashed = vi.fn()
    page.isCrashed = crashed
    expect(() => page.executeJavaScript('1')).toThrow('Object has been destroyed')
    expect(crashed).not.toHaveBeenCalled()
  })
})
