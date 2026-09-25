/** Page-local account memory; never carried into another document or origin. */
export function credentialCapturePageScript(): string {
  return `(() => new Promise((resolve) => {
    if (window.__hronautCredentialWatcherActive) { resolve(null); return; }
    window.__hronautCredentialWatcherActive = true;
    let remembered = null;
    let finished = false;
    const purpose = (input) => (input.autocomplete || '').toLowerCase().split(/\\s+/)
      .find((token) => ['username', 'current-password', 'new-password', 'one-time-code'].includes(token));
    const usable = (input) => input instanceof HTMLInputElement && !input.disabled
      && !input.closest('[hidden], [inert], [aria-hidden="true"]');
    const usernameField = (fields) => {
      const candidates = fields.filter((input) => usable(input)
        && ['text', 'email', 'tel', 'hidden'].includes(input.type)
        && !['one-time-code', 'new-password', 'current-password'].includes(purpose(input)));
      const explicit = candidates.filter((input) => purpose(input) === 'username');
      if (explicit.length) return explicit.length === 1 ? explicit[0] : null;
      const semantic = candidates.filter((input) => input.type !== 'hidden'
        && (input.type === 'email' || /user|email|login|account|identifier/i.test(input.name + ' ' + input.id)));
      return semantic.length === 1 ? semantic[0] : null;
    };
    const fieldsFor = (form) => [...(form ? form.elements : document.querySelectorAll('input'))]
      .filter((input) => input instanceof HTMLInputElement && input.form === form);
    const remember = (field) => {
      remembered = field && field.value && field.value.length <= 512
        ? { field, value: field.value, at: Date.now(), origin: location.origin } : null;
    };
    const finish = (value) => {
      if (finished) return;
      finished = true;
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
      window.removeEventListener('pagehide', onPageHide);
      remembered = null;
      window.__hronautCredentialWatcherActive = false;
      resolve(value);
    };
    const capture = (form) => {
      const fields = fieldsFor(form);
      const account = usernameField(fields);
      const passwords = fields.filter((input) => usable(input) && !input.readOnly
        && input.type === 'password' && input.value && purpose(input) !== 'one-time-code');
      if (!passwords.length) { remember(account); return; }
      if (new Set(passwords.map((input) => input.value)).size > 1) return;
      const password = passwords.find((input) => purpose(input) === 'current-password') || passwords[0];
      if (password.value.length > 16384) return;
      // An explicit account on this step wins, including an intentionally empty value.
      // Never borrow an account from a different form still present on the page.
      const previous = remembered && remembered.origin === location.origin
        && Date.now() - remembered.at <= 300000
        && (!remembered.field.isConnected || remembered.field.form === form)
        ? remembered.value : '';
      const username = account ? account.value : previous;
      if (username.length > 512) return;
      finish({ origin: location.origin, username, password: password.value });
    };
    const onSubmit = (event) => {
      if (event.target instanceof HTMLFormElement) capture(event.target);
    };
    const onInput = (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && usernameField(fieldsFor(input.form)) === input) remember(input);
    };
    const onClick = (event) => {
      const button = event.target instanceof Element ? event.target.closest('button, input[type="submit"], [role="button"]') : null;
      if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
      const form = button.form || button.closest('form');
      const fields = fieldsFor(form);
      if (!fields.some((input) => input.type === 'password')) { remember(usernameField(fields)); return; }
      // Native forms are handled by submit (after constraint validation).
      if (form) return;
      const label = (button.getAttribute('aria-label') || button.textContent || button.value || '').trim();
      if (/^(log\\s*in|sign\\s*in|continue|next)$/i.test(label)) capture(null);
    };
    const onKeydown = (event) => {
      if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement
        && event.target.type === 'password' && !event.target.form) capture(null);
    };
    const onPageHide = () => finish(null);
    const listeners = [['submit', onSubmit], ['input', onInput], ['change', onInput], ['click', onClick], ['keydown', onKeydown]];
    for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
    window.addEventListener('pagehide', onPageHide, { once: true });
  }))()`
}
