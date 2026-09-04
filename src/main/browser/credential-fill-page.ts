import type { CredentialFillContext } from './credential-fill-context.js'
import { javascriptLiteral } from '../../shared/javascript-literal.js'

export function credentialFillPageScript(
  expectedContext: CredentialFillContext,
  username: string,
  password: string
): string {
  return `(() => {
    if (location.origin !== ${javascriptLiteral(expectedContext.origin)}
      || location.href !== ${javascriptLiteral(expectedContext.url)}) return false;
    const autocompleteInfo = (input) => {
      const tokens = (input.getAttribute('autocomplete') || '').trim().toLowerCase().split(/[\\t\\n\\f\\r ]+/).filter(Boolean);
      const purposeTokens = new Set(['username', 'current-password', 'new-password', 'one-time-code']);
      return {
        section: tokens.find((token) => token.startsWith('section-')),
        purpose: [...tokens].reverse().find((token) => purposeTokens.has(token))
      };
    };
    const isVisible = (input) => {
      if (!input.isConnected || input.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const modalDialogs = [...document.querySelectorAll('dialog:modal')];
      const topModal = modalDialogs[modalDialogs.length - 1];
      if (topModal && !topModal.contains(input)) return false;
      if (typeof input.checkVisibility === 'function' && !input.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true
      })) return false;
      const viewport = globalThis.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const right = left + (viewport?.width || innerWidth);
      const bottom = top + (viewport?.height || innerHeight);
      return [...input.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0
        && rect.bottom > top && rect.right > left && rect.top < bottom && rect.left < right);
    };
    const isUsable = (input) => input instanceof HTMLInputElement && !input.matches(':disabled') && !input.readOnly && isVisible(input);
    let passwords = [...document.querySelectorAll('input')]
      .filter((input) => {
        if (input.type !== 'password' || !isUsable(input)) return false;
        const purpose = autocompleteInfo(input).purpose;
        return purpose !== 'new-password' && purpose !== 'one-time-code';
      });
    const focused = document.activeElement;
    let passwordField = focused instanceof HTMLInputElement && passwords.includes(focused) ? focused : undefined;
    if (!passwordField && focused instanceof HTMLInputElement && isUsable(focused) && focused.form) {
      const focusedFormPasswords = passwords.filter((input) => input.form === focused.form);
      if (focusedFormPasswords.length > 0) passwords = focusedFormPasswords;
    }
    if (!passwordField) {
      const currentPasswords = passwords.filter((input) => autocompleteInfo(input).purpose === 'current-password');
      if (currentPasswords.length > 1) return false;
      passwordField = currentPasswords[0] || (passwords.length === 1 ? passwords[0] : undefined);
    }
    if (!passwordField) return false;
    const usernameTypes = new Set(['text', 'email', 'search', 'tel', 'url']);
    const passwordAutocomplete = autocompleteInfo(passwordField);
    const fields = passwordField.form
      ? [...passwordField.form.elements].filter((input) =>
          input instanceof HTMLInputElement
            && input.form === passwordField.form
            && usernameTypes.has(input.type)
            && isUsable(input)
            && !['current-password', 'new-password', 'one-time-code'].includes(autocompleteInfo(input).purpose || '')
            && (!passwordAutocomplete.section || autocompleteInfo(input).section === passwordAutocomplete.section)
        )
      : [];
    const explicitUsernames = fields.filter((input) => autocompleteInfo(input).purpose === 'username');
    const preceding = (input) => Boolean(input.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING);
    const precedingEmails = fields.filter((input) => autocompleteInfo(input).purpose === undefined && input.type === 'email' && preceding(input));
    const precedingSemantic = fields.filter((input) =>
      autocompleteInfo(input).purpose === undefined
        && preceding(input)
        && /username|user|email|login|account|identifier/i.test(input.name + ' ' + input.id)
    );
    const usernameField = explicitUsernames.length === 1
      ? explicitUsernames[0]
      : explicitUsernames.length === 0 && precedingEmails.length === 1
        ? precedingEmails[0]
        : explicitUsernames.length === 0 && precedingEmails.length === 0 && precedingSemantic.length === 1
          ? precedingSemantic[0]
          : undefined;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const assign = (input, value) => {
      if (setter) setter.call(input, value); else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (usernameField) assign(usernameField, ${javascriptLiteral(username)});
    if (!isUsable(passwordField) || passwordField.type !== 'password') return false;
    assign(passwordField, ${javascriptLiteral(password)});
    passwordField.focus({ preventScroll: true });
    return true;
  })()`
}
