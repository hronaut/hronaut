import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn(() => ({ enabled: false })),
  executeInMainWorld: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electron.exposeInMainWorld,
    executeInMainWorld: electron.executeInMainWorld
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
    sendSync: electron.sendSync
  }
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('Hronaut Home page preload', () => {
  it('keeps workspace management out of website preload APIs', async () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'example.com' })
    vi.stubGlobal('addEventListener', vi.fn())
    await import('../src/preload/page.js')
    expect(electron.exposeInMainWorld.mock.calls.some(([name]) => name === 'hronautHome')).toBe(false)
    // One synchronous answer before the page's scripts run, for every opt-in.
    expect(electron.sendSync).toHaveBeenCalledExactlyOnceWith('page:bootstrap')
    expect(electron.executeInMainWorld.mock.calls.some(([options]) => options.func.name === 'installReactInspection')).toBe(false)
  })

  it('forwards workspace inventory and actions only through the Home bridge', async () => {
    vi.stubGlobal('location', { protocol: 'hronaut:', hostname: 'home' })
    vi.stubGlobal('addEventListener', vi.fn())
    await import('../src/preload/page.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautHome')?.[1] as {
      getWorkspaces: () => Promise<unknown>
      workspaceAction: (input: unknown) => Promise<unknown>
    }
    await api.getWorkspaces()
    await api.workspaceAction({ view: 'preferences', workspaceId: 'project', deletionProtected: true })
    expect(electron.invoke).toHaveBeenCalledWith('hronaut-home:workspaces')
    expect(electron.invoke).toHaveBeenCalledWith('hronaut-home:workspace-action', { view: 'preferences', workspaceId: 'project', deletionProtected: true })
  })

  it('passes change notices to Home without their arguments, and stops on unsubscribe', async () => {
    vi.stubGlobal('location', { protocol: 'hronaut:', hostname: 'home' })
    vi.stubGlobal('addEventListener', vi.fn())
    await import('../src/preload/page.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautHome')?.[1] as { onChanged: (listener: (...values: unknown[]) => void) => () => void }
    const listener = vi.fn()
    const unsubscribe = api.onChanged(listener)
    const registered = electron.on.mock.calls.find(([channel]) => channel === 'hronaut-home:changed')?.[1] as (...values: unknown[]) => void
    registered({ sender: 'event' }, 'unexpected payload')
    expect(listener).toHaveBeenCalledWith()
    unsubscribe()
    expect(electron.removeListener).toHaveBeenCalledWith('hronaut-home:changed', registered)
  })

  it('forwards only the selected client ID through its narrow guide bridge', async () => {
    vi.stubGlobal('location', { protocol: 'hronaut:', hostname: 'home' })
    vi.stubGlobal('addEventListener', vi.fn())

    await import('../src/preload/page.js')

    const homeApi = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautHome')?.[1] as {
      openAgentGuide?: (clientId: string) => Promise<unknown>
    } | undefined
    expect(homeApi?.openAgentGuide).toBeTypeOf('function')

    await homeApi?.openAgentGuide?.('opencode')

    expect(electron.invoke).toHaveBeenCalledWith('hronaut-home:open-agent-guide', 'opencode')
    expect(electron.invoke).not.toHaveBeenCalledWith(
      'hronaut-home:open-agent-guide',
      expect.stringMatching(/^https?:/u)
    )
  })

  // Each call Home makes, with the channel and arguments main receives; the names are the wire's and stay as they were.
  it.each([
    ['getWorkspaces', [], 'hronaut-home:workspaces', []],
    ['workspaceAction', [{ view: 'open', workspaceId: 'project' }], 'hronaut-home:workspace-action', [{ view: 'open', workspaceId: 'project' }]],
    ['copyText', ['npx hronaut'], 'hronaut-home:copy-text', ['npx hronaut']],
    ['openAgentGuide', ['opencode'], 'hronaut-home:open-agent-guide', ['opencode']],
    ['openVsCodeInstall', [], 'hronaut-home:open-vscode-install', []],
    ['openSetupHelp', [], 'hronaut-home:open-setup-help', []],
    ['openSetupFeedback', [], 'hronaut-home:open-setup-feedback', []],
    ['getSetupState', [], 'hronaut-home:setup-state', []],
    ['prepareClaudeCodeSetup', [], 'hronaut-home:claude-code-prepare', []],
    ['applyClaudeCodeSetup', ['plan-1'], 'hronaut-home:claude-code-apply', ['plan-1']],
    ['useMcpPort', [47322], 'hronaut-home:use-mcp-port', [47322]]
  ] as const)('Home\'s %s asks main on its channel with its arguments and returns main\'s answer', async (method, args, channel, sent) => {
    vi.stubGlobal('location', { protocol: 'hronaut:', hostname: 'home' })
    vi.stubGlobal('addEventListener', vi.fn())
    electron.invoke.mockResolvedValueOnce('answer' as never)
    await import('../src/preload/page.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautHome')?.[1] as Record<string, (...values: unknown[]) => Promise<unknown>>
    await expect(api[method]!(...args)).resolves.toBe('answer')
    expect(electron.invoke.mock.calls).toStrictEqual([[channel, ...sent]])
  })

  it('answers Home\'s confirm true only when main answers true', async () => {
    vi.stubGlobal('location', { protocol: 'hronaut:', hostname: 'home' })
    vi.stubGlobal('addEventListener', vi.fn())
    await import('../src/preload/page.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautHome')?.[1] as { confirm: (question: unknown) => Promise<boolean> }
    const question = { message: 'Delete the workspace Research?', detail: 'Its tabs close.' }
    electron.invoke.mockResolvedValueOnce(true as never)
    await expect(api.confirm(question)).resolves.toBe(true)
    electron.invoke.mockResolvedValueOnce('yes' as never)
    await expect(api.confirm(question)).resolves.toBe(false)
    expect(electron.invoke).toHaveBeenCalledWith('hronaut-home:confirm', question)
  })

  it('tells Home to show its workspaces without the message\'s arguments', async () => {
    vi.stubGlobal('location', { protocol: 'hronaut:', hostname: 'home' })
    vi.stubGlobal('addEventListener', vi.fn())
    await import('../src/preload/page.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautHome')?.[1] as { onShowWorkspaces: (listener: (...values: unknown[]) => void) => () => void }
    const listener = vi.fn()
    const unsubscribe = api.onShowWorkspaces(listener)
    const registered = electron.on.mock.calls.find(([channel]) => channel === 'hronaut-home:show-workspaces')?.[1] as (...values: unknown[]) => void
    registered({ sender: 'event' }, 'unexpected payload')
    expect(listener).toHaveBeenCalledWith()
    unsubscribe()
    expect(electron.removeListener).toHaveBeenCalledWith('hronaut-home:show-workspaces', registered)
  })

  it('passes a website\'s wallet requests to main and main\'s wallet events to the page\'s providers', async () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'example.com' })
    vi.stubGlobal('addEventListener', vi.fn())
    await import('../src/preload/page.js')
    const bridge = electron.exposeInMainWorld.mock.calls.find(([name]) => name === '__hronautWalletBridge')?.[1] as {
      request: (input: unknown) => Promise<unknown>
      subscribe: (listener: (event: unknown) => void) => void
    }
    const request = { family: 'evm', method: 'eth_requestAccounts' }
    electron.invoke.mockResolvedValueOnce(['0xabc'] as never)
    await expect(bridge.request(request)).resolves.toEqual(['0xabc'])
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('wallet-provider:request', request)
    const listener = vi.fn()
    bridge.subscribe(listener)
    const registered = electron.on.mock.calls.find(([channel]) => channel === 'wallet-provider:event')?.[1] as (...values: unknown[]) => void
    const event = { family: 'evm', event: 'chainChanged', payload: '0x1' }
    registered({ sender: 'event' }, event, 'unexpected payload')
    expect(listener).toHaveBeenCalledExactlyOnceWith(event)
  })

  it('reports a website\'s uncaught exceptions and rejections and its print dialog to main', async () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'example.com' })
    const listeners = new Map<string, (event: unknown) => void>()
    vi.stubGlobal('addEventListener', vi.fn((type: string, listener: (event: unknown) => void) => { listeners.set(type, listener) }))
    await import('../src/preload/page.js')
    listeners.get('error')!({ error: new Error('Boom'), filename: 'https://example.com/app.js', lineno: 3, colno: 7 })
    listeners.get('unhandledrejection')!({ reason: 'Not found' })
    listeners.get('beforeprint')!({ isTrusted: true })
    // Only the browser's own print events count; a page's synthetic one is ignored.
    listeners.get('afterprint')!({ isTrusted: false })
    listeners.get('afterprint')!({ isTrusted: true })
    expect(electron.send.mock.calls).toStrictEqual([
      ['hronaut:page-exception', { timestamp: expect.any(Number), message: 'Boom', stack: expect.any(String), sourceId: 'https://example.com/app.js', lineNumber: 3, columnNumber: 7 }],
      ['hronaut:page-exception', { timestamp: expect.any(Number), message: 'Not found', stack: undefined, promiseRejection: true }],
      ['hronaut:page-print', true],
      ['hronaut:page-print', false]
    ])
  })
})
