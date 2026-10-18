import { describe, expect, it, vi } from 'vitest'
import { guardPageCallsAcrossRendererExit, RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'

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
      page.debugger.sendCommand('Network.getAllCookies')
    ]
    expect(calls.map(call => call.args)).toEqual([
      ['Input.setIgnoreInputEvents', { ignore: true }],
      ['Input.setIgnoreInputEvents', { ignore: false }],
      ['Fetch.continueRequest', { requestId: 'r1' }],
      ['Network.deleteCookies', { name: 'n', domain: 'example.test' }],
      ['Network.getAllCookies']
    ])
    for (const call of calls) call.reply.resolve({})
    await expect(before).resolves.toEqual({})
    await expect(Promise.all(during)).resolves.toEqual([{}, {}, {}, {}])
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
    expect(calls.map(call => [call.kind, ...call.args])).toEqual([
      ['command', 'Page.enable'],
      ['command', 'Runtime.evaluate', { expression: '1' }, 'session-1'],
      ['script', 'document.title', true],
      ['isolated', 7, [{ code: '2' }], true]
    ])
    calls[0]!.reply.resolve({})
    calls[1]!.reply.resolve({ result: 1 })
    calls[2]!.reply.reject(new Error('Script failed'))
    calls[3]!.reply.resolve(2)
    await expect(enabled).resolves.toEqual({})
    await expect(evaluated).resolves.toEqual({ result: 1 })
    await expect(script).rejects.toThrow('Script failed')
    await expect(isolated).resolves.toBe(2)
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
