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
  const unfinished: Array<Promise<void>> = [downloadsEnd]
  await destroyWorkspaceStorage('persist:workspace-a', undefined, () => unfinished.shift())
  expect(calls).toEqual(['clear backgroundFetch cache cookies fileSystems indexedDB localStorage serviceWorkers webSQL', 'flush'])

  endDownloads()
  await vi.waitFor(() => expect(calls.slice(2)).toEqual(['close connections', 'clear everything', 'flush']))
})

it('waits for a download that starts in a closed workspace while it waits for the others', async () => {
  let endFirst!: () => void
  let endSecond!: () => void
  const first = new Promise<void>((resolve) => { endFirst = resolve })
  const second = new Promise<void>((resolve) => { endSecond = resolve })
  const downloads = [first, second]
  await destroyWorkspaceStorage('persist:workspace-a', undefined, () => downloads.shift())
  endFirst()
  await new Promise<void>((resolve) => { setImmediate(resolve) })
  expect(calls).toHaveLength(2)
  endSecond()
  await vi.waitFor(() => expect(calls.slice(2)).toEqual(['close connections', 'clear everything', 'flush']))
})

it('gives the caller a failure to delete the site data of a closed workspace, and deletes nothing later', async () => {
  const { session } = await import('electron')
  const clearData = vi.fn(async () => { throw new Error('clear failed') })
  vi.spyOn(session, 'fromPartition').mockReturnValueOnce({ clearData, closeAllConnections: vi.fn() } as never)
  let endDownloads!: () => void
  await expect(destroyWorkspaceStorage('persist:workspace-a', undefined, () => new Promise<void>((resolve) => { endDownloads = resolve })))
    .rejects.toThrow('clear failed')
  endDownloads()
  await new Promise<void>((resolve) => { setImmediate(resolve) })
  expect(clearData).toHaveBeenCalledOnce()
})
