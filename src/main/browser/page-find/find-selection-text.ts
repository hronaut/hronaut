import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { pageScriptsRunNow } from '../page-script-readiness.js'

/** The longest selected text Find opens with, as in Chrome. */
export const MAX_FIND_SELECTION_LENGTH = 250

// How much of the page's text a selection may hold for Find to read it. A selection of most of a long page, such as a
// large log, is not read in full only to be left out, which would hold the page up.
const MAX_SELECTION_TEXT_READ = 10_000

// Reads the text selected where the page's focus is, trimmed, and nothing else: the selected part of the focused text
// field, or else the selection, in the page or in the frame within it that has the focus, as far as the page's own
// frames and open shadow roots go. It never reads a password field or text shown masked, nor a frame from another
// origin, and answers only with text short enough for Find. It runs in a world of its own, so the page cannot change
// what it reads.
export const SELECTED_TEXT_SCRIPT = `(() => {
  let frame = document
  let field = frame.activeElement
  for (;;) {
    if (field?.contentDocument) {
      frame = field.contentDocument
      field = frame.activeElement
    } else if (field?.shadowRoot?.activeElement) {
      field = field.shadowRoot.activeElement
    } else {
      break
    }
  }
  if (field && ['iframe', 'frame', 'object', 'embed', 'fencedframe'].includes(field.localName)) return ''
  const masked = field && field !== frame.body && frame.defaultView?.getComputedStyle(field).getPropertyValue('-webkit-text-security')
  if (masked && masked !== 'none') return ''
  const input = field?.localName === 'input'
  if (input && field.type === 'password') return ''
  let text = ''
  if (field?.localName === 'textarea' || (input && typeof field.selectionStart === 'number')) {
    text = field.value.slice(field.selectionStart, field.selectionEnd)
  } else {
    const selection = frame.getSelection()
    if (!selection?.rangeCount) return ''
    if (selection.isCollapsed) {
      // A field without a selection range of its own, such as an email or number field, where Chromium answers with
      // the field's selected text.
      if (!input || field.value.length > ${MAX_SELECTION_TEXT_READ}) return ''
    } else {
      // Only the selected part of each text, which a selection of most of a long page holds too much of.
      const range = selection.getRangeAt(0)
      const walker = frame.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
      walker.currentNode = range.startContainer
      let node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer : walker.nextNode()
      let length = 0
      while (node && range.comparePoint(node, 0) <= 0) {
        if (range.intersectsNode(node)) {
          length += (node === range.endContainer ? range.endOffset : node.data.length)
            - (node === range.startContainer ? range.startOffset : 0)
          if (length > ${MAX_SELECTION_TEXT_READ}) return ''
        }
        node = walker.nextNode()
      }
    }
    text = String(selection)
  }
  text = text.trim()
  return text.length <= ${MAX_FIND_SELECTION_LENGTH} ? text : ''
})()`

// How long Find waits for the page to answer with its selected text. A page busy with its own work opens Find with its
// last text instead.
const SELECTED_TEXT_WAIT_MS = 300

/**
 * The text selected in the tab's page, which Find opens with, as Chrome's find bar takes up the selected text: trimmed
 * and at most 250 characters. It is empty with nothing selected, a longer selection, a selection over more than one
 * line, which the one-line Find field cannot hold, a selection in a password field or in a frame from another origin,
 * or a page that cannot answer now.
 */
export async function findSelectionText(browser: Browser, tabId: string): Promise<string> {
  const page = getTab(browser, tabId).webContents
  if (!pageScriptsRunNow(page)) return ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<void>((resolve) => { timer = setTimeout(resolve, SELECTED_TEXT_WAIT_MS) })
  const read = page.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.findSelectionText, [{ code: SELECTED_TEXT_SCRIPT }])
    .catch(() => undefined)
  const text: unknown = await Promise.race([read, waited])
  clearTimeout(timer)
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  return trimmed.length <= MAX_FIND_SELECTION_LENGTH && !/[\r\n]/.test(trimmed) ? trimmed : ''
}
