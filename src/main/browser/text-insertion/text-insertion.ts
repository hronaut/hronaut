import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { TextInsertionAccess, TextInsertionTab } from './text-insertion-access.js'
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

/** The longest text one insertion takes, in UTF-16 code units. */
export const MAX_INSERTED_TEXT_LENGTH = 4096

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
  replaced: 'The editor changed before the text was sent, so nothing was inserted. Take a fresh browser_snapshot and try again.'
}

/** Why the text cannot be inserted, or undefined when it can. Messages never repeat the text. */
export function insertableTextProblem(text: string): string | undefined {
  if (text.length === 0 || text.length > MAX_INSERTED_TEXT_LENGTH) return `Provide 1 to ${MAX_INSERTED_TEXT_LENGTH} characters of text (counted in UTF-16 code units).`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(text)) return 'The text may contain line breaks (\\n) and tabs, but no other control characters.'
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) return 'The text contains an unpaired surrogate, which is not a character.'
  return undefined
}

/**
 * Inserts text into the editor a ref or selector names, at its caret or in
 * place of its selection, through Chromium's native text input
 * (Input.insertText): the page gets the trusted beforeinput, textInput and
 * input events of text a person commits from an input method, and no key
 * events. The editor must be the one text field, text area or editable region
 * of the top-level document that already has focus, visible, enabled and
 * writable, with the caret inside it; it is checked again in the debugger
 * turn just before the text is sent. From then until the outcome is read, a
 * guard in the page cancels the text's insertion into any other element of
 * it. Results and errors never carry the text or the editor's content. It
 * throws before the text is sent when the target, the page or the call's
 * authority is not as required, and afterwards only when the call's authority
 * changed; nothing is retried.
 */
export async function insertText<Tab extends TextInsertionTab>(
  access: TextInsertionAccess<Tab>,
  target: { tabId?: string; ref?: string; selector?: string },
  text: string,
  validateInsertion?: (validateContext: () => void) => void,
  progress: TextInsertionProgress = { sent: false }
): Promise<TextInsertionResult> {
  access.validateTarget(target)
  const problem = insertableTextProblem(text)
  if (problem) throw new Error(problem)
  const tab = access.getTab(target.tabId)
  const webContents = tab.webContents
  const authority = access.nativeInputAuthority(tab, validateInsertion)
  const token = randomUUID()
  const lineBreaks = text.includes('\n')
  let navigated = false
  const navigationStarted = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    // Within the document too: a new route may show another editor in the same place.
    if (details.isMainFrame) navigated = true
  }
  webContents.on('did-start-navigation', navigationStarted)
  try {
    authority.validate()
    editorOf(await runPageScript<TextInsertionLocation>(webContents, textInsertionLocateScript(target, token, 'check', lineBreaks)))
    return await access.withAgentInput(webContents, () => access.withDebugger(webContents, async (): Promise<TextInsertionResult> => {
      const validate = (): void => {
        if (navigated) throw new Error('The page navigated before the text was sent, so nothing was inserted. Inspect it again before inserting.')
        authority.validate()
      }
      validate()
      // Check again inside the debugger turn, and arm the guard: the page may have moved focus or replaced the editor meanwhile.
      const editor = editorOf(await runPageScript<TextInsertionLocation>(webContents, textInsertionLocateScript(target, token, 'arm', lineBreaks)))
      const input = access.agentInputDebugger(webContents, () => {
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
  if (observed.reached) {
    return {
      status: 'NOT_ACCEPTED',
      editor,
      note: observed.cancelled
        ? 'The editor received the text but cancelled it, and its content did not change.'
        : 'The editor received the text but its content did not change, as when a length limit is reached or a controlled field rejects the change.'
    }
  }
  if (observed.blocked > 0) {
    return {
      status: 'BLOCKED',
      editor,
      note: 'Focus moved to another element of the page just before the text arrived, so Hronaut cancelled the insertion there and nothing was inserted. Inspect the page, click the editor again and retry.'
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
    return { current: false, reached: false, cancelled: false, changed: false, blocked: 0, focusLeft: false }
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
