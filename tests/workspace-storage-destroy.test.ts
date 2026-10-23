import { beforeEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])
vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      closeAllConnections: async () => { calls.push('close connections') },
      clearData: async (options?: { dataTypes?: string[] }) => {
        calls.push(options?.dataTypes ? `clear ${options.dataTypes.join(' ')}` : 'clear everything')
      },
      flushStorageData: async () => { calls.push('flush') },
      cookies: { flushStore: async () => undefined }
    })
  }
}))

const { destroyWorkspaceStorage } = await import('../src/main/browser/workspace-storage.js')

beforeEach(() => { calls.length = 0 })

it('closes the connections of a closed workspace and deletes all its storage when nothing downloads in it', async () => {
  await destroyWorkspaceStorage('persist:workspace-a', undefined, () => undefined)
  expect(calls).toEqual(['close connections', 'clear everything', 'flush'])
})

it('lets the downloads of a closed workspace finish, deleting its site data now and the rest once they end', async () => {
  // Closing a workspace closed every connection of its storage, which failed its downloads, and cleared their records,
  // which cancelled the ones Chromium could resume.
  let endDownloads!: () => void
  const downloadsEnd = new Promise<void>((resolve) => { endDownloads = resolve })
  await destroyWorkspaceStorage('persist:workspace-a', undefined, () => downloadsEnd)
  expect(calls).toEqual(['clear backgroundFetch cache cookies fileSystems indexedDB localStorage serviceWorkers webSQL', 'flush'])

  endDownloads()
  await vi.waitFor(() => expect(calls.slice(2)).toEqual(['close connections', 'clear everything', 'flush']))
})
