import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('keeps a resumable interrupted download cancellable after listing it', async ({ appWindow, electronApp, profileDirectory }) => {
  const path = join(profileDirectory, 'partial.txt')
  await writeFile(path, 'partial')
  const pageUrl = 'data:text/html,<title>Interrupted download fixture</title>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(pageUrl)}, active: true })`)
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().some(contents => contents.getURL() === url), pageUrl
  )).toBe(true)
  const nativeState = await electronApp.evaluate(async ({ webContents }, { pageUrl, path }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error('Download fixture page was not found')
    return new Promise<{ state: string; resumable: boolean }>((resolve) => {
      page.session.once('will-download', (_event, item) => {
        resolve({ state: item.getState(), resumable: item.canResume() })
      })
      page.session.createInterruptedDownload({
        path, urlChain: ['http://127.0.0.1:9/partial.txt'], offset: 7,
        length: 100, mimeType: 'text/plain', eTag: 'fixture-partial'
      })
    })
  }, { pageUrl, path })
  expect(nativeState).toEqual({ state: 'interrupted', resumable: true })
  const downloads = await appWindow.evaluate('window.hronautDownloads.list()') as BrowserDownloadState[]
  expect(downloads).toHaveLength(1)
  expect(downloads[0]!.completedAt).toBeUndefined()
  expect(await appWindow.evaluate('window.hronautDownloads.clearFinished()')).toEqual(downloads)
  await appWindow.evaluate(`window.hronautDownloads.cancel(${JSON.stringify(downloads[0]!.id)})`)
  await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
    expect.objectContaining({ id: downloads[0]!.id, state: 'cancelled' })
  ])
  expect(await appWindow.evaluate('window.hronautDownloads.clearFinished()')).toEqual([])
})
