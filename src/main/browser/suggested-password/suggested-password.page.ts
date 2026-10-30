/** The length limits of the field a password is suggested for; -1 where it sets none. */
export interface SuggestedPasswordField {
  minLength: number
  maxLength: number
}

// Both functions run in Hronaut's own isolated world: the page cannot read the field kept between them, and its own
// changes to the value setter, events or focus do not reach them.
interface SuggestedPasswordWorld {
  __hronautSuggestedPasswordField?: WeakRef<HTMLInputElement>
}

/**
 * Keeps the focused password field, which a right-click on it focused, for the fill, and reads its length limits;
 * null when the page is another one than the suggestion was offered for or the focus is in no writable password
 * field.
 */
export function suggestedPasswordFieldInPage(origin: string, url: string): SuggestedPasswordField | null {
  const onPage = location.origin === origin
    && location.href === url
  const writable = (input: unknown): input is HTMLInputElement => input instanceof HTMLInputElement && input.isConnected && input.type === 'password'
    && !input.matches(':disabled') && !input.readOnly
  const scope = globalThis as unknown as SuggestedPasswordWorld
  scope.__hronautSuggestedPasswordField = undefined
  const field = document.activeElement
  if (!onPage || !writable(field)) return null
  scope.__hronautSuggestedPasswordField = new WeakRef(field)
  return { minLength: field.minLength, maxLength: field.maxLength }
}

/**
 * Fills the suggested password into the field the first function kept, while it still has the focus and the page is
 * the one the suggestion was offered for, and into the field that confirms it, with the browser's own value setter
 * and the events typing sends. A field that cannot take the whole password gets none: the password fits the kept
 * field alone, so a short field after it, such as a PIN, takes none rather than shorten it.
 *
 * The field that confirms one is the one Chrome fills: the next text field of the same form (or of the fields
 * outside any form) that shows, when that one is a writable password field that is not for the current password or
 * a one-time code. A field in a shadow root is never focused in the document, so it gets none: Hronaut could not see
 * its form submitted to offer to save the password.
 */
export function fillSuggestedPasswordInPage(origin: string, url: string, password: string): 'none' | 'filled' {
  const onPage = location.origin === origin
    && location.href === url
  const purpose = (input: HTMLInputElement): string | undefined => (input.getAttribute('autocomplete') || '').trim().toLowerCase().split(/[\t\n\f\r ]+/)
    .reverse().find((token) => ['username', 'current-password', 'new-password', 'one-time-code'].includes(token))
  const shown = (input: HTMLInputElement): boolean => input.isConnected && !input.closest('[hidden], [inert], [aria-hidden="true"]')
    && (typeof input.checkVisibility !== 'function' || input.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true
    }))
    && [...input.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)
  const writable = (input: unknown): input is HTMLInputElement => input instanceof HTMLInputElement && input.isConnected && input.type === 'password'
    && !input.matches(':disabled') && !input.readOnly
  const confirmationOf = (field: HTMLInputElement): HTMLInputElement | undefined => {
    const textTypes = new Set(['text', 'email', 'password', 'tel', 'url', 'search', 'number'])
    // Read through the prototype: a field named "elements" would stand in for the form's own list.
    const elements = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements')!.get!
    const group = field.form ? [...(elements.call(field.form) as HTMLFormControlsCollection)] : [...document.querySelectorAll('input')].filter((input) => !input.form)
    const entries = group.filter((input): input is HTMLInputElement => input instanceof HTMLInputElement && input.form === field.form
      && textTypes.has(input.type) && (input === field || shown(input)))
    const index = entries.indexOf(field)
    const next = index >= 0 ? entries[index + 1] : undefined
    return next && writable(next) && !['current-password', 'one-time-code'].includes(purpose(next) || '') ? next : undefined
  }
  const scope = globalThis as unknown as SuggestedPasswordWorld
  const field = scope.__hronautSuggestedPasswordField?.deref()
  scope.__hronautSuggestedPasswordField = undefined
  if (!onPage || !field || document.activeElement !== field || !writable(field)) return 'none'
  const fits = (input: HTMLInputElement): boolean => input.maxLength < 0 || password.length <= input.maxLength
  if (!fits(field)) return 'none'
  const confirmation = confirmationOf(field)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  const assign = (input: HTMLInputElement): void => {
    setter.call(input, password)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  assign(field)
  if (confirmation && fits(confirmation)) assign(confirmation)
  field.focus({ preventScroll: true })
  return 'filled'
}
