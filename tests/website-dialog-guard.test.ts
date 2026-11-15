import { describe, expect, it } from 'vitest'
import { callThroughPageDialogs } from '../src/main/browser/page-dialog-waits.js'
import { guardPageCallsDuringWebsiteDialog, websiteDialogHolds, WebsiteDialogOpenError, whenWebsiteDialogCloses } from '../src/main/browser/website-dialog-guard.js'

function deferred(): { promise: Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void } {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function fakePage(options: { answeredAtOnce?: () => boolean } = {}) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const on = (event: string, listener: (...args: unknown[]) => void): void => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener])
  }
  const calls: Array<{ kind: string; args: unknown[]; reply: ReturnType<typeof deferred> }> = []
  const record = (kind: string) => (...args: unknown[]) => {
    const reply = deferred()
    calls.push({ kind, args, reply })
    return reply.promise
  }
  const page = {
    on,
    executeJavaScript: record('script'),
    executeJavaScriptInIsolatedWorld: record('isolated'),
    debugger: { on: (event: string, listener: (...args: unknown[]) => void) => on(`debugger:${event}`, listener), sendCommand: record('command') }
  }
  guardPageCallsDuringWebsiteDialog(page as never, options.answeredAtOnce ?? (() => false))
  const emit = (event: string, ...args: unknown[]): void => { for (const listener of listeners.get(event) ?? []) listener(...args) }
  // What the page's debugger reports as a website dialog opens and closes; a worker or frame reports with its session.
  const dialogReported = (type: string, sessionId?: string): void =>
    emit('debugger:message', {}, 'Page.javascriptDialogOpening', { type, message: 'Delete it?' }, sessionId)
  const dialogCloses = (sessionId?: string): void => emit('debugger:message', {}, 'Page.javascriptDialogClosed', { result: true }, sessionId)
  /** The page opens a dialog, and Electron shows its box for it in the next turn. */
  const dialogOpens = async (type: string, sessionId?: string): Promise<void> => {
    dialogReported(type, sessionId)
    await nextTurn()
  }
  return { page, calls, emit, dialogReported, dialogOpens, dialogCloses }
}

// An agent's call that met a website's alert or confirm never returned: the dialog holds the page's renderer, so the
// call, every later call on the tab and the workspace waited until the person answered it.
describe('page calls during a website dialog', () => {
  it.each(['alert', 'confirm'])('lets the scripts and commands waiting on the page go when an %s opens', async (type) => {
    const { page, dialogOpens } = fakePage()
    const evaluation = page.debugger.sendCommand('Runtime.evaluate', { expression: 'confirm("Delete it?")' })
    const script = page.executeJavaScript('1', true)
    const isolated = page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }], true)
    const settled = Promise.allSettled([evaluation, script, isolated])
    await dialogOpens(type)
    const [evaluated, scripted, isolatedScript] = await settled
    expect(evaluated).toMatchObject({ status: 'rejected', reason: { name: 'WebsiteDialogOpenError', sent: true } })
    expect(String((evaluated as PromiseRejectedResult).reason)).toContain('The page opened a website dialog during this action')
    expect(scripted).toMatchObject({ status: 'rejected', reason: { sent: true } })
    expect((isolatedScript as PromiseRejectedResult).reason).toBeInstanceOf(WebsiteDialogOpenError)
  })

  it('refuses new calls unsent while the dialog shows and reaches the page again once it closes', async () => {
    const { page, calls, dialogOpens, dialogCloses } = fakePage()
    await dialogOpens('confirm')
    await expect(page.debugger.sendCommand('Page.getFrameTree')).rejects.toMatchObject({ name: 'WebsiteDialogOpenError', sent: false })
    await expect(page.executeJavaScript('1')).rejects.toThrow('nothing was sent to it')
    await expect(page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }])).rejects.toBeInstanceOf(WebsiteDialogOpenError)
    expect(calls).toEqual([])

    dialogCloses()
    const command = page.debugger.sendCommand('Page.getFrameTree')
    expect(calls.map(call => call.kind)).toEqual(['command'])
    calls[0]!.reply.resolve({ frameTree: {} })
    await expect(command).resolves.toEqual({ frameTree: {} })
  })

  it('sends the dialog\'s answer, agent input and the commands the browser process answers while the dialog shows', async () => {
    const { page, calls, dialogOpens } = fakePage()
    await dialogOpens('alert')
    const answer = page.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true })
    const keyUp = page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter' })
    const cookies = page.debugger.sendCommand('Network.getAllCookies')
    expect(calls.map(call => call.args[0])).toEqual(['Page.handleJavaScriptDialog', 'Input.dispatchKeyEvent', 'Network.getAllCookies'])
    for (const call of calls) call.reply.resolve({})
    await expect(answer).resolves.toEqual({})
    await expect(keyUp).resolves.toEqual({})
    await expect(cookies).resolves.toEqual({})
  })

  it.each(['prompt', 'beforeunload'])('holds nothing for a %s, which Electron answers itself at once', async (type) => {
    const { page, calls, dialogOpens } = fakePage()
    const script = page.executeJavaScript('1')
    await dialogOpens(type)
    void page.executeJavaScript('2')
    expect(calls.map(call => call.args[0])).toEqual(['1', '2'])
    expect(websiteDialogHolds(page)).toBe(false)
    calls[0]!.reply.resolve(1)
    await expect(script).resolves.toBe(1)
  })

  it('holds nothing for a dialog that is answered at once, as one an agent\'s action answers', async () => {
    let answeredAtOnce = true
    const { page, calls, dialogOpens, dialogCloses } = fakePage({ answeredAtOnce: () => answeredAtOnce })
    const script = page.executeJavaScript('document.title')
    await dialogOpens('confirm')
    expect(websiteDialogHolds(page)).toBe(false)
    calls[0]!.reply.resolve('Deleted')
    await expect(script).resolves.toBe('Deleted')
    dialogCloses()

    answeredAtOnce = false
    await dialogOpens('confirm')
    expect(websiteDialogHolds(page)).toBe(true)
  })

  it('sends commands for the page\'s workers, and ignores the dialogs they report through their own session', async () => {
    const { page, calls, dialogOpens } = fakePage()
    await dialogOpens('alert', 'worker-session')
    expect(websiteDialogHolds(page)).toBe(false)
    await dialogOpens('alert')
    const worker = page.debugger.sendCommand('Runtime.evaluate', { expression: '1' }, 'worker-session')
    expect(calls.map(call => call.args)).toEqual([['Runtime.evaluate', { expression: '1' }, 'worker-session']])
    calls[0]!.reply.resolve({ result: { value: 1 } })
    await expect(worker).resolves.toEqual({ result: { value: 1 } })
  })

  it.each(['did-navigate', 'render-process-gone', 'destroyed', 'debugger:detach'])('ends the hold on %s', async (event) => {
    const { page, calls, emit, dialogOpens } = fakePage()
    await dialogOpens('alert')
    const closed = whenWebsiteDialogCloses(page)
    emit(event)
    await expect(closed).resolves.toBeUndefined()
    expect(websiteDialogHolds(page)).toBe(false)
    void page.executeJavaScript('1')
    expect(calls.map(call => call.kind)).toEqual(['script'])
  })

  // A page the person stopped from showing more dialogs: Electron turns each one down within the debugger's report.
  it('holds nothing for a dialog Electron turns down at once, and fails no call', async () => {
    const { page, calls, emit, dialogReported, dialogCloses } = fakePage()
    const script = page.executeJavaScript('document.title')
    dialogReported('confirm')
    dialogCloses()
    await nextTurn()
    expect(websiteDialogHolds(page)).toBe(false)
    void page.executeJavaScript('1')
    expect(calls.map(call => call.kind)).toEqual(['script', 'script'])
    calls[0]!.reply.resolve('Boxes')
    await expect(script).resolves.toBe('Boxes')

    // Nor does a dialog whose page goes on to a new document before the box shows.
    dialogReported('alert')
    emit('did-navigate')
    await nextTurn()
    expect(websiteDialogHolds(page)).toBe(false)
  })

  it('lets a call that waits for the person through a dialog, neither failed nor refused', async () => {
    const { page, calls, dialogOpens, dialogCloses } = fakePage()
    const watch = callThroughPageDialogs(() => page.executeJavaScriptInIsolatedWorld(9, [{ code: 'watch' }], false))
    await dialogOpens('alert')
    const pick = callThroughPageDialogs(() => page.executeJavaScript('pick', true))
    // Other calls are still refused meanwhile.
    await expect(page.executeJavaScript('1')).rejects.toBeInstanceOf(WebsiteDialogOpenError)
    expect(calls.map(call => call.args[1] ?? call.args[0])).toEqual([[{ code: 'watch' }], true])
    dialogCloses()
    calls[0]!.reply.resolve({ origin: 'https://example.test' })
    calls[1]!.reply.resolve({ canceled: true })
    await expect(watch).resolves.toEqual({ origin: 'https://example.test' })
    await expect(pick).resolves.toEqual({ canceled: true })
  })

  it('settles a call normally when the page answers before any dialog', async () => {
    const { page, calls, dialogOpens } = fakePage()
    const script = page.executeJavaScript('1')
    calls[0]!.reply.resolve(1)
    await expect(script).resolves.toBe(1)
    await dialogOpens('alert')
    // A call that already settled is not reported again.
    await expect(script).resolves.toBe(1)
  })

  it('tells cleanup when the dialog closes, or at once when none shows', async () => {
    const { page, dialogOpens, dialogCloses } = fakePage()
    await expect(whenWebsiteDialogCloses(page)).resolves.toBeUndefined()
    await dialogOpens('confirm')
    expect(websiteDialogHolds(page)).toBe(true)
    let closed = false
    const waiting = whenWebsiteDialogCloses(page).then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    dialogCloses('worker-session')
    await Promise.resolve()
    expect(closed).toBe(false)
    dialogCloses()
    await waiting
    expect(websiteDialogHolds(page)).toBe(false)
    expect(websiteDialogHolds({})).toBe(false)
  })
})
