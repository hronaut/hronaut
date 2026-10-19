import { expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { registerNetworkRoutesIpc } from '../src/main/network-routes-ipc.js'

type Listener = Parameters<IpcMain['handle']>[1]

function handlers() {
  const registered = new Map<string, Listener>()
  const addNetworkRoute = vi.fn(async () => [])
  registerNetworkRoutesIpc({
    assertTrustedSender: () => {},
    handleBrowserIpc: (channel, listener) => { registered.set(channel, listener) },
    tabs: () => ({ addNetworkRoute }) as never
  })
  const add = (value: unknown) => registered.get('browser:add-network-route')!({} as never, 'tab-1', value)
  return { add, addNetworkRoute }
}

it('refuses held mock responses from the Network panel, which cannot release them', async () => {
  const { add, addNetworkRoute } = handlers()
  const mock = { urlPattern: 'https://app.test/api/*', response: { status: 200, body: 'ok' } }
  await expect(add({ ...mock, holdUntilReleased: true })).rejects.toThrow('available to agents only')
  await expect(add({ ...mock, holdUntilReleased: false })).rejects.toThrow('available to agents only')
  await expect(add({ ...mock, holdSeconds: 5 })).rejects.toThrow('available to agents only')
  expect(addNetworkRoute).not.toHaveBeenCalled()
  await add(mock)
  expect(addNetworkRoute).toHaveBeenCalledWith('tab-1', mock)
})
