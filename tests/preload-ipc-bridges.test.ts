import { afterEach, expect, it, vi } from 'vitest'
import type { EventChannel, InvokeChannel, SendChannel } from '../src/shared/ipc/channel.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

type Bridge = Record<string, (...args: unknown[]) => unknown>

async function exposed(name: string): Promise<Bridge> {
  await import('../src/preload/index.js')
  const api = electron.exposeInMainWorld.mock.calls.find(([exposedName]) => exposedName === name)?.[1] as Bridge | undefined
  if (!api) throw new Error(`${name} is not exposed`)
  return api
}

// Each call the shell makes, with the channel and arguments main receives; the names are the wire's and stay as they were.
const invokes: Array<[api: string, method: string, args: unknown[], channel: string, sent: unknown[]]> = [
  ['hronautLicense', 'getState', [], 'license:get-state', []],
  ['hronautLicense', 'activate', ['KEY-1'], 'license:activate', ['KEY-1']],
  ['hronautLicense', 'refresh', [], 'license:refresh', []],
  ['hronautLicense', 'deactivate', [], 'license:deactivate', []],
  ['hronautLicense', 'openPurchase', [], 'license:open-purchase', []],
  ['hronautUpdates', 'getState', [], 'updates:get-state', []],
  ['hronautUpdates', 'getReleaseHistory', [2, true], 'updates:get-release-history', [2, true]],
  ['hronautUpdates', 'check', [], 'updates:check', []],
  ['hronautUpdates', 'download', [], 'updates:download', []],
  ['hronautUpdates', 'install', [], 'updates:install', []],
  ['hronautTaskManager', 'list', [], 'task-manager:list', []],
  ['hronautTaskManager', 'endProcess', [42], 'task-manager:end-process', [42]],
  ['hronautPermissions', 'list', [], 'permissions:list', []],
  ['hronautPermissions', 'set', ['https://a.test', 'camera', 'allow', 'persistent'], 'permissions:set', ['https://a.test', 'camera', 'allow', 'persistent']],
  ['hronautPermissions', 'remove', ['https://a.test', 'camera', 'session'], 'permissions:remove', ['https://a.test', 'camera', 'session']],
  ['hronautPermissions', 'clear', [], 'permissions:clear', []],
  ['hronautBrowsingData', 'summary', [], 'browsing-data:summary', []],
  ['hronautBrowsingData', 'siteSummary', ['https://a.test/', 'tab-1'], 'browsing-data:site-summary', ['https://a.test/', 'tab-1']],
  ['hronautBrowsingData', 'websites', [], 'browsing-data:websites', []],
  ['hronautBrowsingData', 'clear', [{ cookies: true }], 'browsing-data:clear', [{ cookies: true }]],
  ['hronautCredentials', 'status', [], 'credentials:status', []],
  ['hronautCredentials', 'list', [], 'credentials:list', []],
  ['hronautCredentials', 'importFromCsv', [], 'credentials:import-csv', []],
  ['hronautCredentials', 'fill', ['tab-1', 'credential-1'], 'credentials:fill', ['tab-1', 'credential-1']],
  ['hronautCredentials', 'remove', ['credential-1'], 'credentials:remove', ['credential-1']],
  ['hronautCredentials', 'clear', [], 'credentials:clear', []]
]

it.each(invokes)('%s.%s asks main on its channel with its arguments and returns main\'s answer', async (api, method, args, channel, sent) => {
  electron.invoke.mockResolvedValueOnce('answer')
  const bridge = await exposed(api)
  await expect(bridge[method]!(...args)).resolves.toBe('answer')
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...sent)
})

// Each listener the shell registers, with the channel main sends on and what the listener receives of it.
const listeners: Array<[api: string, method: string, channel: string, received: unknown[]]> = [
  ['hronautLicense', 'onChanged', 'license:changed', [{ status: 'trial' }]],
  ['hronautUpdates', 'onChanged', 'updates:changed', [{ status: 'idle' }]],
  ['hronautUpdates', 'onOpenRequested', 'updates:open', []],
  ['hronautPermissions', 'onChanged', 'permissions:changed', [[{ origin: 'https://a.test' }]]],
  ['hronautCredentials', 'onChanged', 'credentials:changed', [[{ id: 'credential-1' }]]],
  ['hronautCredentials', 'onStatusChanged', 'credentials:status-changed', [{ available: true }]]
]

it.each(listeners)('%s.%s passes on only what the channel carries, without the event or extras, until it is stopped', async (api, method, channel, received) => {
  const bridge = await exposed(api)
  const listener = vi.fn()
  const stop = bridge[method]!(listener) as () => void
  const [, handler] = electron.on.mock.calls.find(([name]) => name === channel)!
  handler({ sender: 'event' }, ...received, 'extra')
  expect(listener.mock.calls).toEqual([received])
  stop()
  expect(electron.removeListener).toHaveBeenCalledExactlyOnceWith(channel, handler)
})

it('sends on a channel without waiting for an answer', async () => {
  const { send } = await import('../src/preload/bridges/ipc.js')
  send('example:notify' as SendChannel<[id: string]>, 'id-1')
  expect(electron.send).toHaveBeenCalledExactlyOnceWith('example:notify', 'id-1')
})

it('checks at compile time that calls and listeners match their channel', () => {
  const ask = 'example:ask' as InvokeChannel<[id: string], number>
  const notify = 'example:notify' as SendChannel<[id: string]>
  const changed = 'example:changed' as EventChannel<[count: number]>
  const typeOnly = async (): Promise<void> => {
    const { invoke, send, subscribe } = await import('../src/preload/bridges/ipc.js')
    const answer: number = await invoke(ask, 'id-1')
    // @ts-expect-error The answer is a number.
    const wrongAnswer: string = await invoke(ask, 'id-1')
    // @ts-expect-error The argument is a string.
    void invoke(ask, 1)
    // @ts-expect-error The argument is required.
    void invoke(ask)
    // @ts-expect-error The channel takes one argument.
    send(notify, 'id-1', 'extra')
    // @ts-expect-error The listener receives a number.
    subscribe(changed, (count: string) => count)
    void [answer, wrongAnswer]
  }
  expect(typeof typeOnly).toBe('function')
})
