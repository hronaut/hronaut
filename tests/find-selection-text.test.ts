// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { findSelectionText, SELECTED_TEXT_SCRIPT } = await import('../src/main/browser/page-find/find-selection-text.js')
const { COLLAPSE_SELECTION_SCRIPT } = await import('../src/main/browser/page-find/page-find.js')
type Browser = import('../src/main/browser/browser.js').Browser
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  getSelection()?.removeAllRanges()
})

function pageWith(answer: () => Promise<unknown>, options: { loading?: boolean } = {}) {
  const webContents = {
    id: 4,
    isDestroyed: () => false,
    getURL: () => 'https://example.test/',
    isLoadingMainFrame: () => options.loading ?? false,
    executeJavaScriptInIsolatedWorld: vi.fn(answer)
  }
  const tab = { id: 'tab', webContents: webContents as unknown as WebContents }
  const browser = { tabs: new Map([[tab.id, tab]]), activeTabId: 'tab' } as unknown as Browser
  return { browser, webContents }
}

describe('the text selected in a page, which Find opens with', () => {
  it('is read in a world of its own and trimmed', async () => {
    const page = pageWith(async () => '\n  needle in a haystack \r\n')
    await expect(findSelectionText(page.browser, 'tab')).resolves.toBe('needle in a haystack')
    expect(page.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledExactlyOnceWith(
      ISOLATED_WORLDS.findSelectionText, [{ code: SELECTED_TEXT_SCRIPT }]
    )
  })

  it('is empty for text over more than one line, which the Find field, holding one line, could not find', async () => {
    for (const text of ['first\nsecond', 'first\r\nsecond', 'first\rsecond']) {
      await expect(findSelectionText(pageWith(async () => text).browser, 'tab')).resolves.toBe('')
    }
  })

  it('is empty for a selection longer than 250 characters, as in Chrome, or an answer that is not text', async () => {
    await expect(findSelectionText(pageWith(async () => `  ${'a'.repeat(250)}  `).browser, 'tab')).resolves.toBe('a'.repeat(250))
    await expect(findSelectionText(pageWith(async () => 'a'.repeat(251)).browser, 'tab')).resolves.toBe('')
    await expect(findSelectionText(pageWith(async () => ({ text: 'needle' })).browser, 'tab')).resolves.toBe('')
  })

  it('is empty, asking nothing, while the page cannot run a script now, and once the script failed', async () => {
    const loading = pageWith(async () => 'needle', { loading: true })
    await expect(findSelectionText(loading.browser, 'tab')).resolves.toBe('')
    expect(loading.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    await expect(findSelectionText(pageWith(async () => { throw new Error('Page went away') }).browser, 'tab')).resolves.toBe('')
  })

  it('is empty once a page slow to answer has had a moment, leaving no timer behind', async () => {
    vi.useFakeTimers()
    const read = findSelectionText(pageWith(() => new Promise(() => undefined)).browser, 'tab')
    await vi.advanceTimersByTimeAsync(300)
    await expect(read).resolves.toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is refused for a tab that does not exist', async () => {
    await expect(findSelectionText(pageWith(async () => 'needle').browser, 'other')).rejects.toThrow()
  })
})

describe('the script reading the selected text', () => {
  const run = () => (0, eval)(SELECTED_TEXT_SCRIPT) as unknown

  it('reads the page\'s selection, trimmed', () => {
    document.body.innerHTML = '<p> needle in a haystack </p>'
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    expect(run()).toBe('needle in a haystack')
  })

  it('reads the selected part of the focused text field', () => {
    document.body.innerHTML = '<p>page text</p><textarea>a needle here</textarea><input value="input needle">'
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    const area = document.querySelector('textarea')!
    area.focus()
    area.setSelectionRange(2, 8)
    expect(run()).toBe('needle')
    const field = document.querySelector('input')!
    field.focus()
    field.setSelectionRange(6, 12)
    expect(run()).toBe('needle')
  })

  it('never reads a password field, and answers nothing for a selection longer than 250 characters', () => {
    document.body.innerHTML = `<input type="password" value="secret value"><p>${'a'.repeat(251)}</p>`
    const field = document.querySelector('input')!
    field.focus()
    field.setSelectionRange(0, 6)
    expect(run()).toBe('')
    field.blur()
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    expect(run()).toBe('')
  })

  it('never reads a password field in a shadow root', () => {
    document.body.innerHTML = '<p>page text</p><div></div>'
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    const root = document.querySelector('div')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<input type="password" value="secret value">'
    const field = root.querySelector('input')!
    field.focus()
    field.setSelectionRange(0, 6)
    expect(root.activeElement).toBe(field)
    expect(run()).toBe('')
  })

  it('reads the selection in the frame within the page that has the focus, and nothing while a frame of another site has it', () => {
    document.body.innerHTML = '<p>page text</p><iframe></iframe><embed tabindex="0">'
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    const frame = document.querySelector('iframe')!
    const inner = frame.contentDocument!
    inner.body.innerHTML = '<p>framed needle</p>'
    inner.getSelection()!.selectAllChildren(inner.querySelector('p')!)
    frame.focus()
    expect(document.activeElement).toBe(frame)
    expect(run()).toBe('framed needle')
    // A frame whose page the script cannot reach, while the page around it keeps its selection.
    const other = document.querySelector('embed')!
    other.focus()
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    expect(document.activeElement).toBe(other)
    expect(run()).toBe('')
  })

  it('does not take a selection of most of a long page as text, leaving it out unread', () => {
    document.body.innerHTML = `<p>${' '.repeat(10_000)}</p><p>needle</p>`
    getSelection()!.selectAllChildren(document.body)
    const text = vi.spyOn(Selection.prototype, 'toString')
    expect(run()).toBe('')
    expect(text).not.toHaveBeenCalled()
    getSelection()!.selectAllChildren(document.querySelectorAll('p')[1]!)
    expect(run()).toBe('needle')
  })

  it('reads a short selection within a long text, counting only the part selected', () => {
    document.body.innerHTML = `<p>first</p><pre>${'x '.repeat(6_000)}needle</pre>`
    const text = document.querySelector('pre')!.firstChild as Text
    const range = document.createRange()
    range.setStart(text, text.data.length - 6)
    range.setEnd(text, text.data.length)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    expect(run()).toBe('needle')
    // From the element holding the text, after the text before it.
    range.setStart(document.body, 1)
    expect(run()).toBe('')
    document.body.innerHTML = `<p>${'x'.repeat(20_000)}</p><p>needle</p>`
    range.setStart(document.body, 1)
    range.setEnd(document.body, 2)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    expect(run()).toBe('needle')
  })

  it('reads the page\'s selection while a control without text of its own has the focus', () => {
    document.body.innerHTML = '<p>needle</p><input type="checkbox"><input type="number" value="12">'
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.focus()
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    expect(run()).toBe('needle')
    // A field without a selection range of its own, whose selected text only Chromium answers with.
    document.querySelector<HTMLInputElement>('input[type="number"]')!.focus()
    getSelection()!.collapse(document.body, 0)
    expect(run()).toBe('')
  })
})

describe('the script collapsing the selection Find searches from', () => {
  it('collapses it to its start in the frame within the page that has the focus', () => {
    document.body.innerHTML = '<p>page text</p><iframe></iframe><button>Elsewhere</button>'
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    const frame = document.querySelector('iframe')!
    const inner = frame.contentDocument!
    inner.body.innerHTML = '<p>framed needle</p>'
    inner.getSelection()!.selectAllChildren(inner.querySelector('p')!)
    frame.focus()
    ;(0, eval)(COLLAPSE_SELECTION_SCRIPT)
    expect(inner.getSelection()!.isCollapsed).toBe(true)
    expect(String(getSelection())).toBe('page text')
    document.querySelector('button')!.focus()
    ;(0, eval)(COLLAPSE_SELECTION_SCRIPT)
    expect(getSelection()!.isCollapsed).toBe(true)
  })

  it('collapses it in a frame within a shadow root that has the focus, as the selected text is read there', () => {
    document.body.innerHTML = '<p>page text</p><div></div>'
    getSelection()!.selectAllChildren(document.querySelector('p')!)
    const root = document.querySelector('div')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<iframe></iframe>'
    const frame = root.querySelector('iframe')!
    const inner = frame.contentDocument!
    inner.body.innerHTML = '<p>framed needle</p>'
    inner.getSelection()!.selectAllChildren(inner.querySelector('p')!)
    frame.focus()
    expect((0, eval)(SELECTED_TEXT_SCRIPT)).toBe('framed needle')
    ;(0, eval)(COLLAPSE_SELECTION_SCRIPT)
    expect(inner.getSelection()!.isCollapsed).toBe(true)
    expect(String(getSelection())).toBe('page text')
  })
})
