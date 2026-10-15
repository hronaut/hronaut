import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserCssStatePreview, type CssStatePreviewHost } from '../src/main/browser/css-state-preview.js'
import { CSS_STATE_PREVIEW_LIMITS, normalizeCssStatePreviewStates } from '../src/shared/css-state-preview.js'

type Handler = (params: Record<string, unknown> | undefined) => unknown

function fixture(options: { keepDomEnabled?: boolean } = {}) {
  const events = new EventEmitter()
  const handlers: Record<string, Handler> = {
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelectorAll': () => ({ nodeIds: [42] }),
    'DOM.describeNode': () => ({ node: { nodeType: 1, localName: 'button' } })
  }
  const attached = vi.fn(() => true)
  const destroyed = vi.fn(() => false)
  const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    const handler = handlers[method]
    return handler ? handler(params) : {}
  })
  const webContents = {
    isDestroyed: destroyed,
    debugger: {
      sendCommand,
      isAttached: attached,
      on: (name: string, listener: (...args: unknown[]) => void) => events.on(name, listener),
      removeListener: (name: string, listener: (...args: unknown[]) => void) => events.removeListener(name, listener)
    }
  } as unknown as WebContents
  const tab = {
    id: 'css-tab',
    title: 'Card fixture',
    url: 'https://example.test/cards?token=private-token#private-hash',
    navigationGeneration: 1,
    observationGeneration: 1,
    webContents
  }
  // Both entry points share one serial queue, like the tab's debugger queue.
  let queue = Promise.resolve()
  const serial = <R>(_tab: unknown, operation: () => Promise<R>): Promise<R> => {
    const run = queue.then(operation)
    queue = run.then(() => undefined, () => undefined)
    return run
  }
  const host = {
    isCurrent: vi.fn(() => true),
    withDebugger: serial,
    inDebuggerQueue: serial,
    conflict: vi.fn((): string | undefined => undefined),
    keepDomEnabled: vi.fn(() => options.keepDomEnabled === true),
    changed: vi.fn()
  }
  const preview = new BrowserCssStatePreview<typeof tab>(host satisfies CssStatePreviewHost<typeof tab>)
  const methods = () => sendCommand.mock.calls.map(([method]) => method)
  const forced = () => sendCommand.mock.calls
    .filter(([method]) => method === 'CSS.forcePseudoState')
    .map(([, params]) => params)
  return { tab, preview, host, handlers, sendCommand, attached, destroyed, events, methods, forced }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('forced CSS state preview', () => {
  it('forces the requested states on exactly one element and reports it as a styling preview', async () => {
    const f = fixture()
    const report = await f.preview.manage(f.tab, 'set', { selector: '  #card  ', states: ['active', 'hover'], durationMs: 5_000 })

    expect(f.methods()).toEqual(['DOM.enable', 'CSS.enable', 'DOM.getDocument', 'DOM.querySelectorAll', 'DOM.describeNode', 'CSS.forcePseudoState'])
    expect(f.sendCommand).toHaveBeenCalledWith('DOM.querySelectorAll', { nodeId: 1, selector: '#card' })
    expect(f.forced()).toEqual([{ nodeId: 42, forcedPseudoClasses: ['hover', 'active'] }])
    expect(report).toMatchObject({
      tabId: 'css-tab',
      status: 'active',
      preview: { states: ['hover', 'active'], selector: '#card' },
      limits: { states: ['hover', 'active'], maxSelectorChars: 512, minDurationMs: 1_000, defaultDurationMs: 30_000, maxDurationMs: 60_000 }
    })
    expect(report.preview!.remainingMs).toBeGreaterThan(4_000)
    expect(report.preview!.remainingMs).toBeLessThanOrEqual(5_000)
    expect(report.url).not.toContain('private')
    expect(report.caveats.join(' ')).toMatch(/No pointer, click, focus or keyboard events/)
    // The renderer projection never carries CDP node IDs.
    expect(JSON.stringify(f.preview.summary(f.tab))).not.toContain('42')
    expect(f.host.changed).toHaveBeenCalled()
  })

  it('validates input before touching the debugger', async () => {
    const f = fixture()
    await expect(f.preview.manage(f.tab, 'set', { states: ['hover'] })).rejects.toThrow('Provide a CSS selector')
    await expect(f.preview.manage(f.tab, 'set', { selector: 'x'.repeat(CSS_STATE_PREVIEW_LIMITS.maxSelectorChars + 1), states: ['hover'] }))
      .rejects.toThrow('Provide a CSS selector')
    await expect(f.preview.manage(f.tab, 'set', { selector: '#card' })).rejects.toThrow('Choose at least one CSS state')
    await expect(f.preview.manage(f.tab, 'set', { selector: '#card', states: ['focus'] })).rejects.toThrow('Only the hover and active')
    await expect(f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'], durationMs: 999 })).rejects.toThrow('durationMs must be')
    await expect(f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'], durationMs: 60_001 })).rejects.toThrow('durationMs must be')
    f.host.conflict.mockReturnValueOnce('Stop code coverage before previewing CSS states')
    await expect(f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })).rejects.toThrow('Stop code coverage')
    await expect(f.preview.manage({ ...f.tab, url: 'hronaut://home/' }, 'set', { selector: '#card', states: ['hover'] }))
      .rejects.toThrow('Open a website tab')
    expect(f.sendCommand).not.toHaveBeenCalled()
    expect(normalizeCssStatePreviewStates(['active', 'hover', 'hover'])).toEqual(['hover', 'active'])
  })

  it.each([
    ['matches more than one element', { nodeIds: [5, 6] }, undefined],
    ['No element in the top-level document', { nodeIds: [] }, undefined],
    ['not the html, head or body element', { nodeIds: [5] }, { node: { nodeType: 1, localName: 'body' } }]
  ])('rejects a selection that %s and leaves no override or domain enabled', async (message, query, node) => {
    const f = fixture()
    f.handlers['DOM.querySelectorAll'] = () => query
    if (node) f.handlers['DOM.describeNode'] = () => node
    await expect(f.preview.manage(f.tab, 'set', { selector: '.card', states: ['hover'] })).rejects.toThrow(message)
    expect(f.forced()).toEqual([])
    expect(f.methods().slice(-2)).toEqual(['CSS.disable', 'DOM.disable'])
    expect((await f.preview.manage(f.tab, 'get')).status).toBe('inactive')
  })

  it('maps an invalid selector to a clear error and keeps DOM enabled for rendering debug', async () => {
    const f = fixture({ keepDomEnabled: true })
    f.handlers['DOM.querySelectorAll'] = () => { throw new Error('DOM Error while querying') }
    await expect(f.preview.manage(f.tab, 'set', { selector: 'a[', states: ['hover'] })).rejects.toThrow('The selector is not valid CSS')
    expect(f.methods().at(-1)).toBe('CSS.disable')
    expect(f.methods()).not.toContain('DOM.disable')
  })

  it('removes a partial override when the page changes during the force command', async () => {
    const f = fixture()
    f.handlers['CSS.forcePseudoState'] = (params) => {
      if ((params?.forcedPseudoClasses as string[]).length) f.tab.navigationGeneration += 1
      return {}
    }
    await expect(f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })).rejects.toThrow('The page changed')
    expect(f.forced()).toEqual([
      { nodeId: 42, forcedPseudoClasses: ['hover'] },
      { nodeId: 42, forcedPseudoClasses: [] }
    ])
    expect(f.preview.active(f.tab)).toBe(false)
  })

  it('clears the override and reports how the preview ended', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.sendCommand.mockClear()
    const report = await f.preview.manage(f.tab, 'clear')
    expect(f.methods()).toEqual(['CSS.forcePseudoState', 'CSS.disable', 'DOM.disable'])
    expect(f.forced()).toEqual([{ nodeId: 42, forcedPseudoClasses: [] }])
    expect(report).toMatchObject({ status: 'inactive', lastEnded: { reason: 'cleared', clean: true } })
    expect(report.preview).toBeUndefined()
    expect(f.events.listenerCount('message')).toBe(0)
  })

  it('treats a node Chromium already unbound as clean', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.handlers['CSS.forcePseudoState'] = () => { throw new Error('Could not find node with given id') }
    expect(await f.preview.manage(f.tab, 'clear')).toMatchObject({ status: 'inactive', lastEnded: { clean: true } })
  })

  it('falls back to disabling the DOM domain, which drops every override in the session', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.handlers['CSS.forcePseudoState'] = () => { throw new Error('Target busy') }
    f.sendCommand.mockClear()
    expect(await f.preview.manage(f.tab, 'clear')).toMatchObject({ status: 'inactive', lastEnded: { clean: true } })
    expect(f.methods()).toEqual(['CSS.forcePseudoState', 'DOM.disable', 'CSS.disable', 'DOM.disable'])
  })

  it('keeps an unconfirmed removal visible and retries it on the next clear', async () => {
    const f = fixture({ keepDomEnabled: true })
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['active'] })
    f.handlers['CSS.forcePseudoState'] = () => { throw new Error('Target busy') }
    const uncertain = await f.preview.manage(f.tab, 'clear')
    expect(uncertain).toMatchObject({ status: 'reset-uncertain', preview: { resetUncertain: true }, lastEnded: { reason: 'cleared', clean: false } })
    expect(f.preview.summary(f.tab)).toMatchObject({ states: ['active'], selector: '#card', resetUncertain: true })
    await expect(f.preview.manage(f.tab, 'set', { selector: '#other', states: ['hover'] })).rejects.toThrow('could not be removed')

    delete f.handlers['CSS.forcePseudoState']
    await f.preview.clear(f.tab, 'human-reset')
    expect(f.preview.summary(f.tab)).toBeUndefined()
    expect(await f.preview.manage(f.tab, 'get')).toMatchObject({ status: 'inactive', lastEnded: { reason: 'human-reset', clean: true } })
  })

  it('replaces an earlier preview after removing its override', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.handlers['DOM.querySelectorAll'] = () => ({ nodeIds: [77] })
    const report = await f.preview.manage(f.tab, 'set', { selector: '#press', states: ['active'] })
    expect(f.forced()).toEqual([
      { nodeId: 42, forcedPseudoClasses: ['hover'] },
      { nodeId: 42, forcedPseudoClasses: [] },
      { nodeId: 77, forcedPseudoClasses: ['active'] }
    ])
    expect(report).toMatchObject({ status: 'active', preview: { selector: '#press', states: ['active'] } })
    expect(report.lastEnded).toBeUndefined()
    expect(f.events.listenerCount('message')).toBe(1)
  })

  it('expires on its own after the bounded duration', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'], durationMs: 1_000 })
    await vi.advanceTimersByTimeAsync(999)
    expect(f.preview.active(f.tab)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.preview.active(f.tab)).toBe(false)
    expect(await f.preview.manage(f.tab, 'get')).toMatchObject({ status: 'inactive', lastEnded: { reason: 'expired', clean: true } })
  })

  it('ends when the page removes the forced element', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.handlers['DOM.describeNode'] = () => { throw new Error('Could not find node with given id') }
    f.events.emit('message', {}, 'DOM.childNodeRemoved', { parentNodeId: 1, nodeId: 42 })
    f.events.emit('message', {}, 'DOM.childNodeRemoved', { parentNodeId: 1, nodeId: 43 })
    await vi.waitFor(() => expect(f.preview.active(f.tab)).toBe(false))
    expect(f.methods().filter(method => method === 'DOM.describeNode')).toHaveLength(2)
    expect(await f.preview.manage(f.tab, 'get')).toMatchObject({ status: 'inactive', lastEnded: { reason: 'target-removed', clean: true } })
    expect(f.events.listenerCount('message')).toBe(0)
  })

  it('keeps the preview when an unrelated node is removed', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.events.emit('message', {}, 'DOM.childNodeRemoved', { parentNodeId: 1, nodeId: 99 })
    expect((await f.preview.manage(f.tab, 'get')).status).toBe('active')
  })

  it('ends cleanly when the DevTools session or the tab goes away', async () => {
    const f = fixture()
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.preview.debuggerDetached(f.tab)
    expect(await f.preview.manage(f.tab, 'get')).toMatchObject({ status: 'inactive', lastEnded: { reason: 'debugger-detached', clean: true } })

    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.attached.mockReturnValue(false)
    f.sendCommand.mockClear()
    await f.preview.clear(f.tab, 'navigation')
    expect(f.sendCommand).not.toHaveBeenCalled()
    expect(await f.preview.manage(f.tab, 'get')).toMatchObject({ status: 'inactive', lastEnded: { reason: 'navigation', clean: true } })

    f.attached.mockReturnValue(true)
    await f.preview.manage(f.tab, 'set', { selector: '#card', states: ['hover'] })
    f.preview.forget(f.tab)
    expect(f.preview.active(f.tab)).toBe(false)
    expect((await f.preview.manage(f.tab, 'get')).lastEnded).toBeUndefined()
  })

  it('ignores lifecycle clears when nothing is forced', async () => {
    const f = fixture()
    await f.preview.clear(f.tab, 'agent-paused')
    expect(f.sendCommand).not.toHaveBeenCalled()
    expect(f.host.changed).not.toHaveBeenCalled()
  })
})
