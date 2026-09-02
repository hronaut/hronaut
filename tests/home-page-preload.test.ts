import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  send: vi.fn(),
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
    send: electron.send
  }
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('Hronaut Home page preload', () => {
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
})
