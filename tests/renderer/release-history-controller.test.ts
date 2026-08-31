import { describe, expect, it, vi } from 'vitest'
import { useReleaseHistoryController } from '../../src/renderer/src/composables/useReleaseHistoryController.js'
import type { AppReleaseHistoryPage } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function page(pageNumber: number, versions: string[], hasMore = false): AppReleaseHistoryPage {
  return {
    page: pageNumber,
    hasMore,
    releases: versions.map((version) => ({
      version,
      title: `Hronaut ${version}`,
      publishedAt: '2026-08-31T14:19:08.000Z',
      url: `https://github.com/hronaut/hronaut/releases/tag/v${version}`,
      notes: `### Fixed\n\n- Release ${version}.`
    }))
  }
}

function createController(getReleaseHistory = vi.fn(async (number: number) => page(number, ['1.11.4']))) {
  const beforeOpen = vi.fn()
  const controller = useReleaseHistoryController({
    api: { getReleaseHistory },
    beforeOpen,
    formatError: (error) => error instanceof Error ? error.message : String(error)
  })
  return { beforeOpen, controller, getReleaseHistory }
}

describe('useReleaseHistoryController', () => {
  it('loads once on open and reuses the in-memory history when reopened', async () => {
    const { beforeOpen, controller, getReleaseHistory } = createController()

    controller.openDialog()
    await vi.waitFor(() => expect(controller.state.value).toBe('ready'))
    controller.close()
    controller.openDialog()

    expect(beforeOpen).toHaveBeenCalledTimes(2)
    expect(getReleaseHistory).toHaveBeenCalledOnce()
    expect(controller.releases.value.map((release) => release.version)).toEqual(['1.11.4'])
  })

  it('ignores a late initial response after close and loads cleanly on the next open', async () => {
    const first = deferred<AppReleaseHistoryPage>()
    const getReleaseHistory = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page(1, ['1.11.5']))
    const { controller } = createController(getReleaseHistory)

    controller.openDialog()
    controller.close()
    first.resolve(page(1, ['1.11.4']))
    await first.promise
    controller.openDialog()
    await vi.waitFor(() => expect(controller.state.value).toBe('ready'))

    expect(controller.releases.value.map((release) => release.version)).toEqual(['1.11.5'])
  })

  it('restores the ready state when a refresh is cancelled by closing the dialog', async () => {
    const refresh = deferred<AppReleaseHistoryPage>()
    const getReleaseHistory = vi.fn()
      .mockResolvedValueOnce(page(1, ['1.11.4']))
      .mockReturnValueOnce(refresh.promise)
    const { controller } = createController(getReleaseHistory)

    controller.openDialog()
    await vi.waitFor(() => expect(controller.state.value).toBe('ready'))
    const refreshing = controller.refresh()
    expect(controller.state.value).toBe('loading')

    controller.close()

    expect(controller.state.value).toBe('ready')
    expect(controller.releases.value.map((release) => release.version)).toEqual(['1.11.4'])

    refresh.resolve(page(1, ['1.11.5']))
    await expect(refreshing).resolves.toBe(false)
    expect(controller.releases.value.map((release) => release.version)).toEqual(['1.11.4'])
  })

  it('appends unique pages and retains loaded releases when loading more fails', async () => {
    const getReleaseHistory = vi.fn()
      .mockResolvedValueOnce(page(1, ['1.11.4'], true))
      .mockResolvedValueOnce(page(2, ['1.11.4', '1.11.3'], true))
      .mockRejectedValueOnce(new Error('GitHub is unavailable'))
    const { controller } = createController(getReleaseHistory)

    controller.openDialog()
    await vi.waitFor(() => expect(controller.state.value).toBe('ready'))
    await expect(controller.loadMore()).resolves.toBe(true)
    await expect(controller.loadMore()).resolves.toBe(false)

    expect(controller.releases.value.map((release) => release.version)).toEqual(['1.11.4', '1.11.3'])
    expect(controller.error.value).toBe('GitHub is unavailable')
    expect(controller.state.value).toBe('ready')
  })
})
