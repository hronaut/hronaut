import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { agentInputDebugger } from '../agent-input-authorization/agent-input-authorization.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { validateTarget } from '../input-targets/input-targets.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'
import { insertableTextProblem } from './inserted-text.js'
import {
  textInsertionDisposeScript,
  textInsertionLocateScript,
  textInsertionObserveScript,
  type TextInsertionEditor,
  type TextInsertionLocation,
  type TextInsertionObservation,
  type TextInsertionTargetProblem
} from './text-insertion-scripts.js'

const TEXT_INSERTION_WORLD_ID = ISOLATED_WORLDS.textInsertion

/** How long one page script or the text's delivery may take before Hronaut gives up on an unresponsive page. */
const PAGE_RESPONSE_TIMEOUT_MS = 5_000

/** How a text insertion ended. None of them proves that the page saved the text. */
export type TextInsertionStatus = 'INSERTED' | 'NOT_ACCEPTED' | 'BLOCKED' | 'UNCONFIRMED'

export interface TextInsertionResult {
  status: TextInsertionStatus
  editor: TextInsertionEditor
  /**
   * For INSERTED: whether Chromium put the text in, or the editor did itself after cancelling Chromium's insertion,
   * as rich-text editors do.
   */
  insertedBy?: 'browser' | 'editor'
  note: string
}

/** Whether the text was sent, from main-process bookkeeping only: a failure from then on leaves the outcome unknown. */
export interface TextInsertionProgress {
  sent: boolean
}

const TARGET_PROBLEMS: Record<TextInsertionTargetProblem, string> = {
  'invalid-selector': 'The selector is not valid CSS.',
  'not-found': 'Editor not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector; elements inside frames and shadow roots cannot be targeted.',
  ambiguous: 'The selector matches more than one element; use a ref or a selector that matches only the editor.',
  'not-editable': 'The target is not a text field, text area or editable region. Text goes into a text, search, URL, telephone, email or password input, a textarea, or a contenteditable element.',
  disabled: 'The field is disabled.',
  readonly: 'The field is read-only.',
  hidden: 'The editor is hidden or has no size.',
  'not-focused': 'The editor does not have focus. Click it with browser_click where the text should go, then insert.',
  'no-caret': 'The caret or selection is not inside the editor. Click in the editor where the text should go, then insert.',
  'single-line': 'A single-line field turns line breaks into spaces. Insert the text without \\n, or use a textarea or editable region.',
  'too-long': 'The field\'s length limit (maxlength) leaves too little room for the whole text, so Chromium would cut it short; nothing was inserted. Insert shorter text, or select the text it should replace first.',
  replaced: 'The editor changed before the text was sent, so nothing was inserted. Take a fresh browser_snapshot and try again.'
}

/**
 * Inserts text into the editor a ref or selector names, at its caret or in
 * place of its selection, through Chromium's native text input
 * (Input.insertText): the page gets the trusted beforeinput, textInput and
 * input events of text a person commits from an input method, and no key
 * events. The editor must be the one text field, text area or editable region
 * of the top-level document that already has focus, visible, enabled and
 * writable, with the caret inside it, and with room for the whole text under
 * a field's length limit; it is checked again in the debugger turn just
 * before the text is sent. From then until the outcome is read, a guard in
 * the page cancels the text's insertion into any other element of the
 * document; it cannot reach frames, so the outcome reports focus that left
 * for one. Results and errors never carry the text or the editor's content. It
 * throws before the text is sent when the target, the page or the call's
 * authority is not as required, and afterwards only when the call's authority
 * changed; nothing is retried.
 */
export async function insertText(
  browser: Browser,
  target: { tabId?: string; ref?: string; selector?: string },
  text: string,
  validateInsertion?: (validateContext: () => void) => void,
  progress: TextInsertionProgress = { sent: false }
): Promise<TextInsertionResult> {
  validateTarget(target)
  const problem = insertableTextProblem(text)
  if (problem) throw new Error(problem)
  const tab = getTab(browser, target.tabId)
  const webContents = tab.webContents
  const authority = nativeInputAuthority(browser, tab, validateInsertion)
  const token = randomUUID()
  const shape = { length: text.length, lineBreaks: text.includes('\n') }
  let navigated = false
  const navigationStarted = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    // Within the document too: a new route may show another editor in the same place.
    if (details.isMainFrame) navigated = true
  }
  webContents.on('did-start-navigation', navigationStarted)
  try {
    authority.validate()
    editorOf(await runPageScript<TextInsertionLocation>(webContents, textInsertionLocateScript(target, token, 'check', shape)))
    return await withAgentInput(browser, webContents, () => withDebugger(browser, webContents, async (): Promise<TextInsertionResult> => {
      const validate = (): void => {
        if (navigated) throw new Error('The page navigated before the text was sent, so nothing was inserted. Inspect it again before inserting.')
        authority.validate()
      }
      validate()
      // Check again inside the debugger turn, and arm the guard: the page may have moved focus or replaced the editor meanwhile.
      const editor = editorOf(await runPageScript<TextInsertionLocation>(webContents, textInsertionLocateScript(target, token, 'arm', shape)))
      const input = agentInputDebugger(browser, webContents, () => {
        // Only the last check before the command decides whether the text was sent.
        progress.sent = false
        validate()
        progress.sent = true
      })
      try {
        await withTimeout(input.sendCommand('Input.insertText', { text }), 'Chromium did not take the text in time')
      } catch (error) {
        if (!progress.sent) throw error
        return {
          status: 'UNCONFIRMED',
          editor,
          note: 'The text was sent, but Chromium reported an error or did not answer in time, so it may have reached the page. Read the editor before trying again; do not insert the text again without checking.'
        }
      }
      const observed = await observe(webContents, token)
      // As after any native input, the result is published only while the call keeps its authority.
      authority.validate()
      return outcome(observed, editor)
    }))
  } finally {
    authority.dispose()
    webContents.removeListener('did-start-navigation', navigationStarted)
    void runPageScript(webContents, textInsertionDisposeScript(token)).catch(() => undefined)
  }
}

/** What the page's text events and the editor's content show about where the text went. */
function outcome(observed: TextInsertionObservation, editor: TextInsertionEditor): TextInsertionResult {
  if (!observed.current) {
    return {
      status: 'UNCONFIRMED',
      editor,
      note: 'The page navigated, reloaded or stopped answering as the text was sent, so Hronaut cannot tell where it went. Read the page before trying again.'
    }
  }
  if (observed.reached && observed.changed) {
    return {
      status: 'INSERTED',
      editor,
      insertedBy: observed.cancelled ? 'editor' : 'browser',
      note: 'The editor took the text and its content changed. This does not prove that the page saved it; read the editor or the page to check.'
    }
  }
  if (observed.blocked > 0 && !observed.changed) {
    // Also when the editor's beforeinput moved focus and Chromium aimed the text's insertion at the new element.
    return {
      status: 'BLOCKED',
      editor,
      note: 'Focus moved to another element of the page just before the text arrived, so Hronaut cancelled the insertion there and nothing was inserted. Inspect the page, click the editor again and retry.'
    }
  }
  if (observed.reached && observed.inputFired) {
    return {
      status: 'UNCONFIRMED',
      editor,
      note: 'The editor reported an edit, but its content is back to what it was, as when a page moves typed text elsewhere or a controlled field resets it. Read the editor and the page before trying again; do not insert the text again without checking.'
    }
  }
  if (observed.reached) {
    return {
      status: 'NOT_ACCEPTED',
      editor,
      note: observed.cancelled
        ? 'The editor received the text but cancelled it, and its content did not change within half a second. An editor may still apply text elsewhere or later; read it before trying again.'
        : 'The editor received the text but did not apply it: its content did not change and it reported no edit.'
    }
  }
  return {
    status: 'UNCONFIRMED',
    editor,
    note: observed.focusLeft
      ? 'Focus left the editor for a frame or another window as the text was sent, where Hronaut cannot guard it, and the editor did not receive the text. It may have gone there; read the page before trying again.'
      : observed.changed
        ? 'The editor\'s content changed, but Hronaut did not see the text arrive, so it cannot tell whether the change is the text. Read the editor before trying again.'
        : 'No text reached the editor and its content did not change. Chromium may not have delivered it, or the page stopped its events before Hronaut could see them; read the page before trying again.'
  }
}

function editorOf(location: TextInsertionLocation): TextInsertionEditor {
  if ('problem' in location) throw new Error(TARGET_PROBLEMS[location.problem])
  return location.editor
}

async function observe(webContents: WebContents, token: string): Promise<TextInsertionObservation> {
  try {
    return await runPageScript<TextInsertionObservation>(webContents, textInsertionObserveScript(token))
  } catch {
    // A page that navigated or stopped answering shows nothing.
    return { current: false, reached: false, cancelled: false, inputFired: false, changed: false, blocked: 0, focusLeft: false }
  }
}

async function runPageScript<T>(webContents: WebContents, code: string): Promise<T> {
  return await withTimeout(
    webContents.executeJavaScriptInIsolatedWorld(TEXT_INSERTION_WORLD_ID, [{ code }], false) as Promise<T>,
    'The page did not respond in time; no text was sent to it'
  )
}

async function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), PAGE_RESPONSE_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
