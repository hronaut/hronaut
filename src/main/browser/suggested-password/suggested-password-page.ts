import type { CredentialFillContext } from '../credential-fill-context.js'
import { javascriptLiteral } from '../../../shared/javascript-literal.js'

/** The length limits of the field a password is suggested for; -1 where it sets none. */
export interface SuggestedPasswordField {
  minLength: number
  maxLength: number
}

export function isSuggestedPasswordField(value: unknown): value is SuggestedPasswordField {
  if (typeof value !== 'object' || value === null) return false
  const { minLength, maxLength } = value as Record<string, unknown>
  return Number.isSafeInteger(minLength) && Number.isSafeInteger(maxLength)
}

// Both scripts run in Hronaut's own isolated world: the page cannot read the field kept between them, and its own
// changes to the value setter, events or focus do not reach them.
const FIELD = 'globalThis.__hronautSuggestedPasswordField'

/**
 * What both scripts share: whether the page is the one the suggestion was offered for, a field's autocomplete purpose,
 * whether it shows, as a saved password's fill checks (but anywhere on the page), whether it is a writable password
 * field, and the field that confirms one, as Chrome fills it: the next text field of the same form (or of the fields
 * outside any form) that shows, when that one is a writable password field that is not for the current password or a
 * one-time code. A field in a shadow root is never focused in the document, so it gets none: Hronaut could not see
 * its form submitted to offer to save the password.
 */
function helpers(expectedContext: CredentialFillContext): string {
  return `const onPage = location.origin === ${javascriptLiteral(expectedContext.origin)}
      && location.href === ${javascriptLiteral(expectedContext.url)};
    const purpose = (input) => (input.getAttribute('autocomplete') || '').trim().toLowerCase().split(/[\\t\\n\\f\\r ]+/)
      .reverse().find((token) => ['username', 'current-password', 'new-password', 'one-time-code'].includes(token));
    const shown = (input) => input.isConnected && !input.closest('[hidden], [inert], [aria-hidden="true"]')
      && (typeof input.checkVisibility !== 'function' || input.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true
      }))
      && [...input.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0);
    const writable = (input) => input instanceof HTMLInputElement && input.isConnected && input.type === 'password'
      && !input.matches(':disabled') && !input.readOnly;
    const confirmationOf = (field) => {
      const textTypes = new Set(['text', 'email', 'password', 'tel', 'url', 'search', 'number']);
      // Read through the prototype: a field named "elements" would stand in for the form's own list.
      const elements = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get;
      const group = field.form ? [...elements.call(field.form)] : [...document.querySelectorAll('input')].filter((input) => !input.form);
      const entries = group.filter((input) => input instanceof HTMLInputElement && input.form === field.form
        && textTypes.has(input.type) && (input === field || shown(input)));
      const index = entries.indexOf(field);
      const next = index >= 0 ? entries[index + 1] : undefined;
      return next && writable(next) && !['current-password', 'one-time-code'].includes(purpose(next) || '') ? next : undefined;
    };`
}

/**
 * Keeps the focused password field, which a right-click on it focused, for the fill, and reads its length limits;
 * null when the page is another one or the focus is in no writable password field. The password fits that field
 * alone: a short field after it, such as a PIN, takes none rather than shorten it.
 */
export function suggestedPasswordFieldScript(expectedContext: CredentialFillContext): string {
  return `(() => {
    ${helpers(expectedContext)}
    ${FIELD} = undefined;
    const field = document.activeElement;
    if (!onPage || !writable(field)) return null;
    ${FIELD} = new WeakRef(field);
    return { minLength: field.minLength, maxLength: field.maxLength };
  })()`
}

/**
 * Fills the suggested password into the field the first script kept, while it still has the focus, and into the
 * field that confirms it, with the browser's own value setter and the events typing sends. A field that cannot take
 * the whole password gets none.
 */
export function suggestedPasswordFillScript(expectedContext: CredentialFillContext, password: string): string {
  return `(() => {
    ${helpers(expectedContext)}
    const field = ${FIELD}?.deref();
    ${FIELD} = undefined;
    if (!onPage || !field || document.activeElement !== field || !writable(field)) return 'none';
    const password = ${javascriptLiteral(password)};
    const fits = (input) => input.maxLength < 0 || password.length <= input.maxLength;
    if (!fits(field)) return 'none';
    const confirmation = confirmationOf(field);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const assign = (input) => {
      setter.call(input, password);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    assign(field);
    if (confirmation && fits(confirmation)) assign(confirmation);
    field.focus({ preventScroll: true });
    return 'filled';
  })()`
}
