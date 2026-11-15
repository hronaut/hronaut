import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { readHighlightPageText } from '../src/main/browser/context-menus/highlight-page-text.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

// Copy link to highlight made its link from the menu's selected text alone, which cuts words, joins table cells and
// leaves out text the page makes unselectable, so the link often found nothing. It now reads the page's text.

const START = '\uFDD0'
const END = '\uFDD1'

function page(answer: () => Promise<unknown>, destroyed = false) {
  const executeJavaScriptInIsolatedWorld = vi.fn(answer)
  return { webContents: { isDestroyed: () => destroyed, executeJavaScriptInIsolatedWorld } as unknown as WebContents, executeJavaScriptInIsolatedWorld }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('reading the page\'s text for a link to a highlight', () => {
  it('gives the runs with the selection\'s place, in a world of the read\'s own', async () => {
    const { webContents, executeJavaScriptInIsolatedWorld } = page(async () => ({ runs: ['Pick the word', `Then ${START}the word${END} again`] }))
    await expect(readHighlightPageText(webContents, 'the word')).resolves.toEqual({
      runs: ['Pick the word', 'Then the word again'],
      start: { run: 1, offset: 5 },
      end: { run: 1, offset: 13 }
    })
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledExactlyOnceWith(ISOLATED_WORLDS.linkToHighlight, [{ code: expect.stringContaining('getSelection()') }])
    await expect(readHighlightPageText(page(async () => ({ runs: [`${START}Alpha`, 'Beta', `Gamma${END}`] })).webContents, 'Alpha Beta Gamma'))
      .resolves.toEqual({ runs: ['Alpha', 'Beta', 'Gamma'], start: { run: 0, offset: 0 }, end: { run: 2, offset: 5 } })
    // The menu separates table cells with a tab, and the page's text gives each cell a run.
    await expect(readHighlightPageText(page(async () => ({ runs: [`${START}Price`, `Total${END}`] })).webContents, '\nPrice\tTotal\n')).resolves.toMatchObject({ runs: ['Price', 'Total'] })
  })

  it('keeps text the page makes unselectable, which the menu leaves out', async () => {
    const { webContents } = page(async () => ({ runs: [`${START}Press Ctrl K now${END}`] }))
    await expect(readHighlightPageText(webContents, 'Press  K now')).resolves.toMatchObject({ runs: ['Press Ctrl K now'] })
  })

  it('gives nothing when the page\'s selection is no longer the menu\'s', async () => {
    const { webContents } = page(async () => ({ runs: [`${START}Other words${END}`] }))
    await expect(readHighlightPageText(webContents, 'the word')).resolves.toBeUndefined()
    // The menu's text must read in order within the page's.
    await expect(readHighlightPageText(page(async () => ({ runs: [`${START}word the${END}`] })).webContents, 'the word')).resolves.toBeUndefined()
  })

  it('gives nothing for an answer without one start before one end', async () => {
    for (const runs of [['the word'], [`${START}the word`], [`the word${END}`], [`${END}the word${START}`], [`${START}the${START} word${END}`], [`${START}the word${END}${END}`], [`${START}the`, 7], 'runs']) {
      await expect(readHighlightPageText(page(async () => ({ runs })).webContents, 'the word'), JSON.stringify(runs)).resolves.toBeUndefined()
    }
    for (const answer of [null, undefined, 'text', { runs: null }]) {
      await expect(readHighlightPageText(page(async () => answer).webContents, 'the word')).resolves.toBeUndefined()
    }
  })

  it('gives nothing when the page is gone, fails or does not answer in time', async () => {
    const gone = page(async () => ({ runs: [`${START}the word${END}`] }), true)
    await expect(readHighlightPageText(gone.webContents, 'the word')).resolves.toBeUndefined()
    expect(gone.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    await expect(readHighlightPageText(page(async () => { throw new Error('Script failed to execute') }).webContents, 'the word')).resolves.toBeUndefined()
    vi.useFakeTimers()
    const read = readHighlightPageText(page(() => new Promise(() => undefined)).webContents, 'the word')
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(read).resolves.toBeUndefined()
  })
})
