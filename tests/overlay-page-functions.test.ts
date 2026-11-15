// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { readHighlightPageText } from '../src/main/browser/context-menus/highlight-page-text.js'
import {
  cancelScreenshotAreaScript,
  screenshotAreaNativeInputScript,
  screenshotAreaScript,
  type ScreenshotAreaSelection
} from '../src/main/browser/page-scripts/screenshot-area-script.js'

// The overlay scripts are built from page functions; these run them as main sends them, in a page.

const run = (script: string): unknown => window.eval(script) as unknown
const overlays = (): number => document.querySelectorAll('[data-hronaut-screenshot-area]').length
const cleanups: Array<() => void> = []

/** Sets a property jsdom may not have, such as checkVisibility, and puts back what was there after the test. */
function stub(owner: object, name: string, value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(owner, name)
  Object.defineProperty(owner, name, { configurable: true, writable: true, value })
  cleanups.push(() => { if (own) Object.defineProperty(owner, name, own); else delete (owner as Record<string, unknown>)[name] })
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  run(cancelScreenshotAreaScript())
  getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('screenshot area in a page', () => {
  it('takes native input scaled to the page, asks again for a tiny area, and resolves once its overlay is gone', async () => {
    const picked = run(screenshotAreaScript()) as Promise<ScreenshotAreaSelection>
    expect(overlays()).toBe(4)
    expect(document.documentElement.style.cursor).toBe('crosshair')
    expect(run(screenshotAreaNativeInputScript('down', 10, 20, innerWidth, innerHeight))).toBe(true)
    expect(run(screenshotAreaNativeInputScript('up', 11, 20, innerWidth, innerHeight))).toBe(false)
    expect(document.querySelector('[data-hronaut-screenshot-area="hint"]')!.textContent).toBe('Drag a larger area  ·  Esc to cancel')
    expect(run(screenshotAreaNativeInputScript('down', 10, 20, innerWidth, innerHeight))).toBe(true)
    expect(run(screenshotAreaNativeInputScript('move', 50, 60, innerWidth, innerHeight))).toBe(true)
    expect(document.querySelector('[data-hronaut-screenshot-area="size"]')!.textContent).toBe('40 × 40')
    // Main's viewport is twice the page's here, so its point is halved.
    expect(run(screenshotAreaNativeInputScript('up', 220, 160, innerWidth * 2, innerHeight * 2))).toBe(true)
    expect(overlays()).toBe(0)
    expect(document.documentElement.style.cursor).toBe('')
    await expect(picked).resolves.toEqual({
      canceled: false,
      clip: { x: 10, y: 20, width: 100, height: 60 },
      pageClip: { x: 10, y: 20, width: 100, height: 60 },
      viewport: { width: innerWidth, height: innerHeight },
      url: location.href
    })
    expect(run(screenshotAreaNativeInputScript('down', 10, 20, innerWidth, innerHeight))).toBe(false)
    expect(run(cancelScreenshotAreaScript())).toBe(false)
  })

  it('cancels for Esc or a cancel call, and replaces a running picker', async () => {
    const first = run(screenshotAreaScript()) as Promise<ScreenshotAreaSelection>
    const second = run(screenshotAreaScript()) as Promise<ScreenshotAreaSelection>
    await expect(first).resolves.toEqual({ canceled: true })
    expect(overlays()).toBe(4)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    await expect(second).resolves.toEqual({ canceled: true })
    const third = run(screenshotAreaScript()) as Promise<ScreenshotAreaSelection>
    expect(run(cancelScreenshotAreaScript())).toBe(true)
    await expect(third).resolves.toEqual({ canceled: true })
    expect(overlays()).toBe(0)
  })
})

describe('page text for a link to a highlight', () => {
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (_world: number, scripts: Array<{ code: string }>) => run(scripts[0]!.code)
  } as unknown as WebContents

  function select(node: Node, start: number, endNode: Node, end: number): void {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(endNode, end)
    getSelection()!.addRange(range)
  }

  it('reads shown text as runs, with spaces collapsed and the selection marked', async () => {
    document.body.innerHTML = '<p>Pick <b>the</b>   word</p><p id="then">Then the <span>word</span> again</p><button>Skip</button><p id="last">Last</p>'
    stub(Element.prototype, 'checkVisibility', () => true)
    stub(window, 'getComputedStyle', (element: Element) => ({
      display: ['b', 'span'].includes(element.localName) ? 'inline' : 'block',
      visibility: 'visible',
      whiteSpaceCollapse: 'collapse',
      content: 'none'
    }))
    const then = document.getElementById('then')!
    select(then.firstChild!, 5, document.getElementById('last')!.firstChild!, 2)
    await expect(readHighlightPageText(webContents, 'the word again La')).resolves.toEqual({
      runs: ['Pick the word', 'Then the word again', 'Last'],
      start: { run: 1, offset: 5 },
      end: { run: 2, offset: 2 }
    })
    getSelection()!.removeAllRanges()
    await expect(readHighlightPageText(webContents, 'the word')).resolves.toBeUndefined()
  })
})
