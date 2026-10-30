import { afterEach, expect, it, vi } from 'vitest'
import type { EventChannel, InvokeChannel } from '../src/shared/ipc/channel.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

type Method = (...args: unknown[]) => unknown

// A method of an exposed API by its path, as `collections.list` on window.hronautBookmarks.
async function exposed(name: string, path: string): Promise<Method> {
  await import('../src/preload/index.js')
  const api: unknown = electron.exposeInMainWorld.mock.calls.find(([exposedName]) => exposedName === name)?.[1]
  const method = path.split('.').reduce<unknown>((owner, key) => (owner as Record<string, unknown> | undefined)?.[key], api)
  if (typeof method !== 'function') throw new Error(`${name}.${path} is not exposed`)
  return method as Method
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
  ['hronautPermissions', 'set', ['https://a.test', 'camera', 'allow', { workspaceId: 'workspace-1' }], 'permissions:set', ['https://a.test', 'camera', 'allow', { workspaceId: 'workspace-1' }]],
  ['hronautPermissions', 'remove', ['https://a.test', 'camera', { workspaceId: 'workspace-1' }], 'permissions:remove', ['https://a.test', 'camera', { workspaceId: 'workspace-1' }]],
  ['hronautPermissions', 'clear', [], 'permissions:clear', []],
  ['hronautBrowsingData', 'summary', [], 'browsing-data:summary', []],
  ['hronautBrowsingData', 'siteSummary', ['https://a.test/', 'tab-1'], 'browsing-data:site-summary', ['https://a.test/', 'tab-1']],
  ['hronautBrowsingData', 'websites', [], 'browsing-data:websites', []],
  ['hronautBrowsingData', 'clear', [{ history: true, origin: 'https://a.test' }], 'browsing-data:clear', [{ history: true, origin: 'https://a.test' }]],
  ['hronautCredentials', 'status', [], 'credentials:status', []],
  ['hronautCredentials', 'list', [], 'credentials:list', []],
  ['hronautCredentials', 'importFromCsv', [], 'credentials:import-csv', []],
  ['hronautCredentials', 'fill', ['tab-1', 'credential-1'], 'credentials:fill', ['tab-1', 'credential-1']],
  ['hronautCredentials', 'remove', ['credential-1'], 'credentials:remove', ['credential-1']],
  ['hronautCredentials', 'clear', [], 'credentials:clear', []],
  ['hronautDownloads', 'list', [], 'downloads:list', [false]],
  ['hronautDownloads', 'list', [true], 'downloads:list', [true]],
  ['hronautDownloads', 'pause', ['download-1'], 'downloads:pause', ['download-1']],
  ['hronautDownloads', 'resume', ['download-1'], 'downloads:resume', ['download-1']],
  ['hronautDownloads', 'cancel', ['download-1'], 'downloads:cancel', ['download-1']],
  ['hronautDownloads', 'retry', ['download-1'], 'downloads:retry', ['download-1']],
  ['hronautDownloads', 'removeFinished', ['download-1'], 'downloads:remove-finished', ['download-1']],
  ['hronautDownloads', 'clearFinished', [], 'downloads:clear-finished', []],
  ['hronautDownloads', 'showInFolder', ['download-1'], 'downloads:show-in-folder', ['download-1']],
  ['hronautDownloads', 'startDrag', ['download-1'], 'downloads:start-drag', ['download-1']],
  ['hronautBookmarks', 'list', [], 'bookmarks:list', []],
  ['hronautBookmarks', 'add', ['https://a.test/', 'A'], 'bookmarks:add', ['https://a.test/', 'A']],
  ['hronautBookmarks', 'addIfMissing', ['https://a.test/', 'A'], 'bookmarks:add-if-missing', ['https://a.test/', 'A']],
  ['hronautBookmarks', 'rename', ['bookmark-1', 'B'], 'bookmarks:rename', ['bookmark-1', 'B']],
  ['hronautBookmarks', 'updateDestination', ['bookmark-1', 'https://b.test/'], 'bookmarks:update-destination', ['bookmark-1', 'https://b.test/']],
  ['hronautBookmarks', 'remove', ['bookmark-1'], 'bookmarks:remove', ['bookmark-1']],
  ['hronautBookmarks', 'exportFile', [], 'bookmarks:export-file', []],
  ['hronautBookmarks', 'importFile', [], 'bookmarks:import-file', []],
  ['hronautBookmarks', 'collections.list', [], 'bookmark-collections:list', []],
  ['hronautBookmarks', 'collections.create', ['Reading'], 'bookmark-collections:create', ['Reading']],
  ['hronautBookmarks', 'collections.rename', ['collection-1', 'Later'], 'bookmark-collections:rename', ['collection-1', 'Later']],
  ['hronautBookmarks', 'collections.remove', ['collection-1'], 'bookmark-collections:remove', ['collection-1']],
  ['hronautBookmarks', 'collections.assign', ['bookmark-1', null], 'bookmark-collections:assign', ['bookmark-1', null]],
  ['hronautBookmarks', 'collections.bookmarkTabs', [null, 'Tabs'], 'bookmark-collections:bookmark-tabs', [null, 'Tabs']],
  ['hronautHistory', 'list', [], 'visit-history:list', []],
  ['hronautHistory', 'remove', ['entry-1'], 'visit-history:remove', ['entry-1']],
  ['hronautHistory', 'clear', [], 'visit-history:clear', []],
  ['hronautMcp', 'getState', [], 'mcp:get-state', []],
  ['hronautMcp', 'setPaused', [true], 'mcp:set-paused', [true]],
  ['hronautMcp', 'moveToSuggestedPort', [9334], 'mcp:move-to-suggested-port', [9334]]
]

it.each(invokes)('%s.%s asks main on its channel with its arguments and returns main\'s answer', async (api, method, args, channel, sent) => {
  electron.invoke.mockResolvedValueOnce('answer')
  const call = await exposed(api, method)
  await expect(call(...args)).resolves.toBe('answer')
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...sent)
})

// Each listener the shell registers, with the channel main sends on and what the listener receives of it.
const listeners: Array<[api: string, method: string, channel: string, received: unknown[]]> = [
  ['hronautLicense', 'onChanged', 'license:changed', [{ status: 'trial' }]],
  ['hronautUpdates', 'onChanged', 'updates:changed', [{ status: 'idle' }]],
  ['hronautUpdates', 'onOpenRequested', 'updates:open', []],
  ['hronautPermissions', 'onChanged', 'permissions:changed', [[{ origin: 'https://a.test' }]]],
  ['hronautCredentials', 'onChanged', 'credentials:changed', [[{ id: 'credential-1' }]]],
  ['hronautCredentials', 'onStatusChanged', 'credentials:status-changed', [{ available: true }]],
  ['hronautDownloads', 'onChanged', 'browser:downloads-changed', [[{ id: 'download-1' }]]],
  ['hronautBookmarks', 'onChanged', 'bookmarks:changed', [[{ id: 'bookmark-1' }]]],
  ['hronautBookmarks', 'collections.onChanged', 'bookmark-collections:changed', [{ revision: 1, collections: [] }]],
  ['hronautHistory', 'onChanged', 'visit-history:changed', [[{ id: 'entry-1' }]]],
  ['hronautHistory', 'onUpdated', 'visit-history:updated', [{ entries: [], removedIds: ['entry-1'] }]],
  ['hronautMcp', 'onChanged', 'mcp:changed', [{ paused: false }]]
]

it.each(listeners)('%s.%s passes on only what the channel carries, without the event or extras, until it is stopped', async (api, method, channel, received) => {
  const subscribe = await exposed(api, method)
  const listener = vi.fn()
  const stop = subscribe(listener) as () => void
  const [, handler] = electron.on.mock.calls.find(([name]) => name === channel)!
  handler({ sender: 'event' }, ...received, 'extra')
  expect(listener.mock.calls).toEqual([received])
  expect(stop()).toBeUndefined()
  expect(electron.removeListener).toHaveBeenCalledExactlyOnceWith(channel, handler)
})

it('checks at compile time that calls and listeners match their channel', () => {
  const ask = 'example:ask' as InvokeChannel<[id: string], number>
  const changed = 'example:changed' as EventChannel<[count: number]>
  const typeOnly = async (): Promise<void> => {
    const { invoke, subscribe } = await import('../src/preload/bridges/ipc.js')
    const answer: number = await invoke(ask, 'id-1')
    // @ts-expect-error The answer is a number.
    const wrongAnswer: string = await invoke(ask, 'id-1')
    // @ts-expect-error The argument is a string.
    void invoke(ask, 1)
    // @ts-expect-error The argument is required.
    void invoke(ask)
    // @ts-expect-error The channel takes one argument.
    void invoke(ask, 'id-1', 'extra')
    // @ts-expect-error The channel decides the argument's type; a value of unknown type does not widen it.
    void invoke(ask, JSON.parse('"id-1"') as unknown)
    // @ts-expect-error The listener receives a number.
    subscribe(changed, (count: string) => count)
    void [answer, wrongAnswer]
  }
  expect(typeof typeOnly).toBe('function')
})
