/** Why the target cannot take the text: each maps to one message in text-insertion.ts. */
export type TextInsertionTargetProblem =
  'invalid-selector' | 'not-found' | 'ambiguous' | 'not-editable' | 'disabled' | 'readonly' | 'hidden' | 'not-focused' | 'no-caret' | 'single-line' | 'too-long' | 'replaced'

/** The kind of editor the text goes into. */
export type TextInsertionEditor = 'input' | 'textarea' | 'contenteditable'

/** The editor the text goes into, or why it cannot take it. */
export type TextInsertionLocation = { editor: TextInsertionEditor } | { problem: TextInsertionTargetProblem; count?: number }

/** What the page's trusted text events showed once the text was sent. */
export interface TextInsertionObservation {
  /** The record for this insertion is still on the page: it was not navigated or reloaded. */
  current: boolean
  /** A trusted beforeinput or textInput carrying the text reached the editor. */
  reached: boolean
  /** One of the page's handlers cancelled that beforeinput or textInput. */
  cancelled: boolean
  /** A trusted input event on the editor reported an edit. */
  inputFired: boolean
  /** The editor's content differs from what it was just before the text was sent. */
  changed: boolean
  /** How many text insertions aimed at another element of the page the guard cancelled. */
  blocked: number
  /** Focus left the editor, for another element, a frame or another window, while the text was sent. */
  focusLeft: boolean
}

/** The editor as the checks read it: a text field's members are there only on a field. */
type EditorHost = HTMLElement & Partial<Pick<HTMLInputElement, 'type' | 'readOnly' | 'maxLength' | 'value' | 'selectionStart' | 'selectionEnd'>>

/** The guard's state once the insertion is armed. */
interface ArmedInsertion {
  armed: boolean
  content: () => string | undefined
  before: string | undefined
  events: Event[]
  blocked: number
  inputFired: boolean
  focusLeft: boolean
  wake: (() => void) | null
  stop: () => void
  dispose: () => void
}

/** The record kept under an insertion's token: the editor from the check, and the guard from the arm phase. */
type InsertionRecord = { host: EditorHost; editor: TextInsertionEditor } & Partial<ArmedInsertion>

type InsertionsPage = typeof globalThis & { __hronautTextInsertions?: Map<string, InsertionRecord> }

/**
 * Runs in the text insertion's isolated world: resolves the one element the ref or selector names in the top-level
 * document and checks that it is a text field, text area or editable region (for an element inside an editable region,
 * its editing host) that is visible, enabled, writable and already focused, with the caret or selection inside it, that
 * a single-line field is not given line breaks, and that a field's length limit leaves room for the whole text. The
 * check phase records the editor under the token. The arm phase checks that the editor is still the recorded one, notes
 * its content and starts the guard: from then until the observation, for at most guardLifetimeMs or until the document
 * is hidden, a trusted text insertion aimed at any other element of the document is cancelled, and the insertion's
 * events on the editor and focus leaving it are recorded.
 */
export function textInsertionLocateInPage(
  target: { ref?: string; selector?: string },
  token: string,
  phase: 'check' | 'arm',
  textLength: number,
  lineBreaks: boolean,
  guardLifetimeMs: number
): TextInsertionLocation {
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(target.ref ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector as string)
  } catch {
    return { problem: 'invalid-selector' }
  }
  if (matches.length === 0) return { problem: 'not-found' }
  if (matches.length > 1) return { problem: 'ambiguous', count: matches.length }
  const element = matches[0] as EditorHost
  let editor: TextInsertionEditor | null = null
  let host = element
  if (element.localName === 'textarea') editor = 'textarea'
  else if (element.localName === 'input') editor = ['text', 'search', 'url', 'tel', 'email', 'password'].includes(element.type as string) ? 'input' : null
  else if (element.isContentEditable) {
    editor = 'contenteditable'
    // Focus and the text's events belong to the editing host, the outermost editable element.
    while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement
  }
  if (!editor) return { problem: 'not-editable' }
  const page = globalThis as InsertionsPage
  const insertions = page.__hronautTextInsertions || (page.__hronautTextInsertions = new Map())
  const recorded = insertions.get(token)
  if (phase === 'arm' && (!recorded || recorded.host !== host)) return { problem: 'replaced' }
  if (editor !== 'contenteditable') {
    if (host.matches(':disabled')) return { problem: 'disabled' }
    if (host.readOnly) return { problem: 'readonly' }
  }
  const style = getComputedStyle(host)
  const rect = host.getBoundingClientRect()
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) {
    return { problem: 'hidden' }
  }
  if (document.activeElement !== host) return { problem: 'not-focused' }
  if (editor === 'contenteditable') {
    const selection = getSelection()
    if (!selection || selection.rangeCount === 0 || !host.contains(selection.anchorNode) || !host.contains(selection.focusNode)) {
      return { problem: 'no-caret' }
    }
  }
  if (lineBreaks && editor === 'input') return { problem: 'single-line' }
  if (editor !== 'contenteditable' && (host.maxLength as number) >= 0) {
    // Chromium cuts text that does not fit short. An email field reports no selection, so its room is counted without one.
    const selected = typeof host.selectionStart === 'number' ? (host.selectionEnd as number) - host.selectionStart : 0
    if ((host.value as string).length - selected + textLength > (host.maxLength as number)) return { problem: 'too-long' }
  }
  if (phase === 'check') {
    insertions.set(token, { host, editor })
    return { editor }
  }
  const state = recorded as InsertionRecord & ArmedInsertion
  const content = (): string | undefined => editor === 'contenteditable' ? host.innerHTML : host.value
  Object.assign(state, { armed: true, content, before: content(), events: [], blocked: 0, inputFired: false, focusLeft: false, wake: null })
  const onText = (event: Event & { inputType?: string }): void => {
    if (!event.isTrusted || !state.armed) return
    if (event.type === 'beforeinput' && event.inputType !== 'insertText') return
    // Chromium aims the text's events at the focused element, which was the editor itself: any other target,
    // a field nested inside the editor included, means focus moved.
    if (event.target === host) state.events.push(event)
    else {
      event.preventDefault()
      state.blocked += 1
    }
    if (state.wake) state.wake()
  }
  const onInput = (event: Event): void => {
    if (event.isTrusted && state.armed && event.target === host) state.inputFired = true
  }
  const onFocusOut = (event: Event): void => {
    if (state.armed && event.target === host) state.focusLeft = true
  }
  const onBlur = (event: Event): void => {
    // The window loses focus when focus moves into a frame or out of the page.
    if (state.armed && event.target === window) state.focusLeft = true
  }
  // A document kept in the back/forward cache must not keep cancelling a person's typing after it returns.
  const onPageHide = (): void => state.stop()
  const listeners: Array<[string, (event: Event) => void]> = [['beforeinput', onText], ['textInput', onText], ['input', onInput], ['focusout', onFocusOut], ['blur', onBlur], ['pagehide', onPageHide]]
  const expiry = setTimeout(() => state.stop(), guardLifetimeMs)
  state.stop = () => {
    state.armed = false
    clearTimeout(expiry)
    for (const [type, listener] of listeners) removeEventListener(type, listener, true)
  }
  state.dispose = () => {
    state.stop()
    insertions.delete(token)
  }
  // Capture listeners on the window see the events before the page's own
  // handlers on the editor; the recorded events show afterwards whether one
  // of them cancelled the insertion.
  for (const [type, listener] of listeners) addEventListener(type, listener, true)
  return { editor }
}

/**
 * Runs in the text insertion's isolated world: stops the guard, if it has not expired yet, and reports what the text's
 * events under the token showed. Chromium dispatches them before it acknowledges the text, so the answer waits only
 * briefly for a page that is still busy. Then it lets the page's handlers and a task after them run, and gives an
 * editor that applies the text itself, after cancelling Chromium's insertion, half a second to change its content.
 */
export async function textInsertionObserveInPage(token: string): Promise<TextInsertionObservation> {
  const page = globalThis as InsertionsPage
  const state = page.__hronautTextInsertions && page.__hronautTextInsertions.get(token) as InsertionRecord & ArmedInsertion | undefined
  if (!state || !state.stop) return { current: false, reached: false, cancelled: false, inputFired: false, changed: false, blocked: 0, focusLeft: false }
  if (state.armed && !state.events.length && !state.blocked) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { state.wake = null; resolve() }, 250)
      state.wake = () => { clearTimeout(timer); state.wake = null; resolve() }
    })
  }
  state.stop()
  // A message task runs after the event's dispatch, so after the page's handlers.
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })
  const changed = (): boolean => state.content() !== state.before
  const reached = state.events.length > 0
  const deadline = performance.now() + 500
  while (reached && !changed() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  return {
    current: true,
    reached,
    cancelled: state.events.some((event) => event.defaultPrevented),
    inputFired: state.inputFired,
    changed: changed(),
    blocked: state.blocked,
    focusLeft: state.focusLeft
  }
}

/** Runs in the text insertion's isolated world: stops the guard under the token and forgets the editor's content. */
export function textInsertionDisposeInPage(token: string): true {
  const insertions = (globalThis as InsertionsPage).__hronautTextInsertions
  const state = insertions && insertions.get(token)
  if (state && state.dispose) state.dispose()
  else if (insertions) insertions.delete(token)
  return true
}
