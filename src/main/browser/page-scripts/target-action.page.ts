/** An element as an action names it: a snapshot ref or a CSS selector. */
export interface ActionTarget { ref?: string; selector?: string }

/** Why native editing refuses the element: Chromium's own disabledness, or readonly where it applies. */
export type NativeEditabilityFailure = { nativeEditability: 'disabled' | 'readonly' }

/** A number, date or time field that does not take the text in its format. */
export type TypedTextRefusal = { typedText: 'not-accepted'; inputType: string }

/** What a field holds after the write: the text, or for a secret field only whether it differs from what was typed. */
export type HeldText = { value: string } | { heldDiffers: true }

/** A field to fill: its target and the text, or for a checkbox or radio button whether it is checked. */
export interface FormFieldInPage extends ActionTarget { value: string | boolean }

type ElementOf = (target: ActionTarget) => Element | null
type EditabilityFailure = (element: Element) => NativeEditabilityFailure | null
type ValueSetter = ((this: Element, value: string) => void) | undefined
type WriteTypedText = (element: HTMLInputElement | HTMLTextAreaElement, value: string, setter: ValueSetter) => TypedTextRefusal | null
type HeldTextOf = (element: Element, value: string) => HeldText
type ReleaseDialogs = (id: string) => void

type DialogName = 'alert' | 'confirm' | 'prompt'
type DialogsPage = Window & typeof globalThis & Record<DialogName | symbol, unknown>
interface EvaluationDialogs { active: { id: string; accept: boolean }[]; originals: Record<string, PropertyDescriptor | undefined> }

/** Runs in the page: the element the target names, or null. */
export function targetElementInPage(target: ActionTarget): Element | null {
  return target.ref
    ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
    : target.selector ? document.querySelector(target.selector) : null
}

/**
 * Runs in the page: why native editing refuses the element, or null. Native readonly applies only to these input
 * states, not checkbox/radio/select or ARIA labels; the fieldset and first-legend rules stay delegated to Chromium.
 */
export function editabilityFailureInPage(element: Element): NativeEditabilityFailure | null {
  if (element.matches(':disabled')) return { nativeEditability: 'disabled' }
  if (element instanceof HTMLTextAreaElement && element.readOnly ||
      element instanceof HTMLInputElement && element.readOnly &&
      ['text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number'].includes(element.type)) {
    return { nativeEditability: 'readonly' }
  }
  return null
}

/**
 * Runs in the page: writes the text, or returns a marker and leaves the field untouched when a number, date or time
 * field does not take it in its format, which would empty it: setting the value directly left the field empty while
 * reporting the text. The text is tried on a detached field of the same type first, so the page's field, what it shows
 * and its edit state stay as they were.
 */
export function writeTypedTextInPage(element: HTMLInputElement | HTMLTextAreaElement, value: string, setter: ValueSetter): TypedTextRefusal | null {
  if (!setter) return null
  if (element instanceof HTMLInputElement && value !== ''
    && ['number', 'date', 'time', 'datetime-local', 'month', 'week'].includes(element.type)) {
    const trial = document.createElement('input')
    trial.type = element.type
    setter.call(trial, value)
    if (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(trial) === '') {
      return { typedText: 'not-accepted', inputType: element.type }
    }
  }
  setter.call(element, value)
  return null
}

/**
 * Runs in the page: what the field holds once the page's own input and change handlers that run at once have formatted
 * it. Reads go through the native getter, as a page can redefine the value property on its own element. Fields that
 * hold a secret never return a value the page put there: the result has the typed text when the field holds it, else
 * heldDiffers, as a page that rejects the write may restore what the person typed.
 */
export function heldTextInPage(element: Element, value: string): HeldText {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : null
  // An editable region reports the text written, not the rest of its content.
  if (!prototype) return { value }
  const held = Object.getOwnPropertyDescriptor(prototype, 'value')!.get!.call(element) as string
  const secret = element instanceof HTMLInputElement && (element.type === 'password'
    || /(?:^|\s)(?:current-password|new-password|one-time-code|cc-\S+)(?:\s|$)/i.test(element.getAttribute('autocomplete') || ''))
  if (!secret || held === value) return { value: secret ? value : held }
  return { heldDiffers: true }
}

/**
 * Runs in the page: clicks the element the target names after scrolling it into view and focusing it. A natively
 * disabled element returns a bounded marker instead, as executeJavaScript does not preserve thrown messages; Chromium
 * implements fieldset inheritance and the first-legend exception, and aria-disabled alone does not suppress activation.
 */
export function clickTargetInPage(target: ActionTarget, elementOf: ElementOf): { ok: true; tag: string } | { nativeDisabled: true } {
  const element = elementOf(target) as HTMLElement | null
  if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  element.focus()
  if (element.matches(':disabled')) return { nativeDisabled: true }
  element.click()
  return { ok: true, tag: element.tagName.toLowerCase() }
}

/**
 * Runs in the page: types the text into the field or editable region the target names, as input and change events,
 * and submits its form when asked. Native editability is checked before and after scrolling and focusing, and again
 * right before the write.
 */
export function typeTargetInPage(
  target: ActionTarget,
  value: string,
  submit: boolean,
  elementOf: ElementOf,
  editabilityFailure: EditabilityFailure,
  writeTypedText: WriteTypedText,
  heldText: HeldTextOf
): ({ ok: true; tag: string } & HeldText) | NativeEditabilityFailure | TypedTextRefusal {
  const element = elementOf(target) as HTMLElement | null
  if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  { const failure = editabilityFailure(element); if (failure) return failure }
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  element.focus()
  { const failure = editabilityFailure(element); if (failure) return failure }
  if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    { const failure = editabilityFailure(element); if (failure) return failure }
    { const refused = writeTypedText(element, value, setter); if (refused) return refused }
  } else if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    { const failure = editabilityFailure(element); if (failure) return failure }
    { const refused = writeTypedText(element, value, setter); if (refused) return refused }
  } else if (element.isContentEditable) {
    { const failure = editabilityFailure(element); if (failure) return failure }
    element.textContent = value
  } else {
    throw new Error('Target is not an editable element.')
  }
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  // What the field holds once the page's own input and change handlers that run at once have formatted it.
  const held = heldText(element, value)
  if (submit) {
    const form = element.closest('form')
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit()
    else element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  }
  return { ok: true, tag: element.tagName.toLowerCase(), ...held }
}

/**
 * Runs in the page: chooses the option of the select element the target names whose value, label or text is the given
 * text, as input and change events. Native editability is checked before and after scrolling and focusing, and again
 * right before the write.
 */
export function selectTargetInPage(
  target: ActionTarget,
  value: string,
  elementOf: ElementOf,
  editabilityFailure: EditabilityFailure
): { ok: true; tag: 'select'; value: string; label: string } | NativeEditabilityFailure {
  const element = elementOf(target) as HTMLElement | null
  if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  { const failure = editabilityFailure(element); if (failure) return failure }
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  element.focus()
  { const failure = editabilityFailure(element); if (failure) return failure }
  if (!(element instanceof HTMLSelectElement)) throw new Error('Target is not a select element.')
  const option = [...element.options].find((candidate) => candidate.value === value || candidate.label === value || candidate.text === value)
  if (!option) throw new Error('Select option not found: ' + value)
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  { const failure = editabilityFailure(element); if (failure) return failure }
  setter?.call(element, option.value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, tag: 'select', value: option.value, label: option.label || option.text }
}

/**
 * Runs in the page: answers the page's alert, confirm and prompt as asked until the returned function restores them.
 * A prompt gets the given text, or else its default, when accepted.
 */
export function overrideDialogsInPage(accept: boolean, hasPromptText: boolean, promptResponse: string): () => void {
  const page = window as DialogsPage
  const originalDialogs = Object.fromEntries(
    ['alert', 'confirm', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)])
  )
  Object.defineProperties(window, {
    alert: {
      configurable: true,
      writable: true,
      value: function () { return undefined }
    },
    confirm: {
      configurable: true,
      writable: true,
      value: function () { return accept }
    },
    prompt: {
      configurable: true,
      writable: true,
      value: function (_message: unknown, defaultValue: unknown) {
        if (!accept) return null
        if (hasPromptText) return promptResponse
        return arguments.length > 1 ? String(defaultValue) : ''
      }
    }
  })
  const restoreDialogs = function (): void {
    for (const name of ['alert', 'confirm', 'prompt'] as const) {
      const descriptor = originalDialogs[name]
      if (descriptor) Object.defineProperty(window, name, descriptor)
      else delete page[name]
    }
  }
  return restoreDialogs
}

/** Runs in the page: clicks the element the target names with the page's dialogs answered as asked during the click. */
export function dialogAwareClickInPage(
  target: ActionTarget,
  accept: boolean,
  hasPromptText: boolean,
  promptResponse: string,
  elementOf: ElementOf,
  overrideDialogs: (accept: boolean, hasPromptText: boolean, promptResponse: string) => () => void
): { ok: true; tag: string } | { nativeDisabled: true } {
  const element = elementOf(target) as HTMLElement | null
  if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  element.focus()
  const restoreDialogs = overrideDialogs(accept, hasPromptText, promptResponse)
  try {
    if (element.matches(':disabled')) return { nativeDisabled: true }
    element.click()
    return { ok: true, tag: element.tagName.toLowerCase() }
  } finally {
    restoreDialogs()
  }
}

/** Runs in the page: dispatches a click at a viewport point with the page's dialogs answered as asked during the click. */
export function dialogAwareCoordinateClickInPage(
  point: { x: number; y: number },
  accept: boolean,
  hasPromptText: boolean,
  promptResponse: string,
  overrideDialogs: (accept: boolean, hasPromptText: boolean, promptResponse: string) => () => void
): { ok: true; tag: string; x: number; y: number } {
  const element = document.elementFromPoint(point.x, point.y)
  if (!(element instanceof Element)) throw new Error('No element exists at the requested viewport coordinates.')
  if (element instanceof HTMLElement) element.focus()
  const restoreDialogs = overrideDialogs(accept, hasPromptText, promptResponse)
  try {
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: 0
    }))
    return { ok: true, tag: element.tagName.toLowerCase(), x: point.x, y: point.y }
  } finally {
    restoreDialogs()
  }
}

/**
 * Runs in the page: ends one evaluation's dialog handling, by its id, also for an evaluation whose call stopped waiting
 * while its script still runs. When no evaluation still handles dialogs, the page's own alert, confirm and prompt come
 * back.
 */
export function releaseEvaluationDialogsInPage(id: string): void {
  const page = window as DialogsPage
  const state = page[Symbol.for('hronaut.evaluationDialogs')] as EvaluationDialogs | undefined
  if (!state) return
  state.active = state.active.filter((entry) => entry.id !== id)
  if (state.active.length) return
  for (const name of ['alert', 'confirm', 'prompt'] as const) {
    const descriptor = state.originals[name]
    if (descriptor) Object.defineProperty(window, name, descriptor)
    else delete page[name]
  }
  delete page[Symbol.for('hronaut.evaluationDialogs')]
}

/**
 * Runs in the page: runs the script with the page's dialogs answered as asked until it settles. Evaluations that
 * overlap, such as one still running after its call stopped waiting, share one set of handlers that follows the latest
 * evaluation and keep the page's own dialogs to restore when the last one ends. The script runs as an indirect eval,
 * in the page's global scope.
 */
export async function dialogAwareEvaluateInPage(script: string, accept: boolean, id: string, releaseDialogs: ReleaseDialogs): Promise<unknown> {
  const page = window as DialogsPage
  const key = Symbol.for('hronaut.evaluationDialogs')
  let state = page[key] as EvaluationDialogs | undefined
  if (!state) {
    state = {
      active: [],
      originals: Object.fromEntries(['alert', 'confirm', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)]))
    }
    Object.defineProperty(window, key, { configurable: true, value: state })
    const accepts = (): boolean => state!.active.length > 0 && state!.active[state!.active.length - 1]!.accept
    Object.defineProperties(window, {
      alert: { configurable: true, writable: true, value: function () { return undefined } },
      confirm: { configurable: true, writable: true, value: function () { return accepts() } },
      prompt: {
        configurable: true,
        writable: true,
        value: function (_message: unknown, defaultValue: unknown) {
          if (!accepts()) return null
          return arguments.length > 1 ? String(defaultValue) : ''
        }
      }
    })
  }
  state.active.push({ id, accept })
  try {
    // An indirect eval runs the script in the page's global scope, not this function's. Bundlers keep (0, eval) as
    // written; Rolldown turns eval called through a local binding into a direct eval. It is read inside the try, so a
    // page whose eval getter throws still gets its own dialogs back.
    return await (0, eval)(script)
  } finally {
    releaseDialogs(id)
  }
}

/** Runs in the page: whether the element the target names is attached, detached, visible or hidden, as asked. */
export function targetStateInPage(target: ActionTarget, state: 'attached' | 'detached' | 'visible' | 'hidden', elementOf: ElementOf): { matches: boolean } {
  const element = elementOf(target)
  const attached = element instanceof Element && element.isConnected
  let visible = false
  if (attached) {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    visible = style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.visibility !== 'collapse'
      && rect.width > 0
      && rect.height > 0
  }
  return {
    matches: state === 'attached' ? attached
      : state === 'detached' ? !attached
        : state === 'visible' ? visible
          : !visible
  }
}

/**
 * Runs in the page: fills each field in order, as typing or choosing does, and stops at the first field that is
 * missing, refuses native editing, does not take its text or has no such option. Those come back as markers, not
 * thrown errors: main names the fields already filled, and executeJavaScript may drop a thrown message.
 */
export function fillFormInPage(
  fields: FormFieldInPage[],
  elementOf: ElementOf,
  editabilityFailure: EditabilityFailure,
  writeTypedText: WriteTypedText,
  heldText: HeldTextOf
): Record<string, unknown>[] | Record<string, unknown> {
  const results: Record<string, unknown>[] = []
  for (const [index, field] of fields.entries()) {
    const result = ((): Record<string, unknown> => {
      const element = elementOf(field) as HTMLElement | null
      if (!element) return { formField: 'missing' }
      { const failure = editabilityFailure(element); if (failure) return failure }
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      element.focus()
      { const failure = editabilityFailure(element); if (failure) return failure }
      if (element instanceof HTMLSelectElement) {
        const value = String(field.value)
        const option = [...element.options].find((candidate) => candidate.value === value || candidate.label === value || candidate.text === value)
        if (!option) return { formField: 'option-not-found', option: value }
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        { const failure = editabilityFailure(element); if (failure) return failure }
        setter?.call(element, option.value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return { index, tag: 'select', value: option.value, label: option.label || option.text }
      }
      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        const checked = typeof field.value === 'boolean' ? field.value : field.value === 'true'
        { const failure = editabilityFailure(element); if (failure) return failure }
        if (element.checked !== checked) element.click()
        return { index, tag: 'input', type: element.type, checked: element.checked }
      }
      const value = String(field.value)
      if (element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        { const failure = editabilityFailure(element); if (failure) return failure }
        { const refused = writeTypedText(element, value, setter); if (refused) return refused }
      } else if (element instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        { const failure = editabilityFailure(element); if (failure) return failure }
        { const refused = writeTypedText(element, value, setter); if (refused) return refused }
      } else if (element.isContentEditable) {
        { const failure = editabilityFailure(element); if (failure) return failure }
        element.textContent = value
      } else {
        return { formField: 'not-editable' }
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { index, tag: element.tagName.toLowerCase(), ...heldText(element, value) }
    })()
    if (result.nativeEditability || result.typedText || result.formField) return { ...result, fieldIndex: index + 1 }
    results.push(result)
  }
  return results
}

/**
 * Runs in the page: the viewport center of the element the target names, after scrolling it into view. With
 * rejectNativeDisabled, a natively disabled element returns a bounded marker instead.
 */
export function targetPointInPage(target: ActionTarget, rejectNativeDisabled: boolean, elementOf: ElementOf): { x: number; y: number; tag: string } | { nativeDisabled: true } {
  const element = elementOf(target)
  if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Element has no visible bounds.')
  if (rejectNativeDisabled && element.matches(':disabled')) return { nativeDisabled: true }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: element.tagName.toLowerCase() }
}

/**
 * Runs in the page: the viewport centers of a drag's source and destination. Destination scrolling can move the
 * source, so both are measured only after all scrolling, in one evaluation, and native input uses one viewport.
 */
export function dragPointsInPage(sourceTarget: ActionTarget, destinationTarget: ActionTarget, elementOf: ElementOf): {
  from: { x: number; y: number; tag: string }
  to: { x: number; y: number; tag: string }
} {
  const source = elementOf(sourceTarget)
  const target = elementOf(destinationTarget)
  if (!source || !target) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  source.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const point = (element: Element): { x: number; y: number; tag: string } => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Element has no visible bounds.')
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: element.tagName.toLowerCase() }
  }
  return { from: point(source), to: point(target) }
}
