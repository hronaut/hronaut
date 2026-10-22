function nativeDisabledClickGuardScript(): string {
  // Chromium implements fieldset inheritance and the first-legend exception.
  // aria-disabled alone does not suppress native activation.
  // Return a bounded marker: executeJavaScript does not preserve thrown messages.
  return `if (element.matches(':disabled')) return { nativeDisabled: true };`
}

// Native readonly applies only to these input states, not checkbox/radio/select
// or ARIA labels. Keep the fieldset/first-legend rules delegated to Chromium.
function nativeEditabilityScript(): string {
  return `const editabilityFailure = () => {
    if (element.matches(':disabled')) return { nativeEditability: 'disabled' };
    if (element instanceof HTMLTextAreaElement && element.readOnly ||
        element instanceof HTMLInputElement && element.readOnly &&
        ['text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number'].includes(element.type)) {
      return { nativeEditability: 'readonly' };
    }
    return null;
  };`
}

function nativeEditabilityGuardScript(): string {
  return `{ const failure = editabilityFailure(); if (failure) return failure; }`
}

// Writes the text, or returns a marker and leaves the field untouched when a number, date or time field does not take
// it in its format, which would empty it: setting the value directly left the field empty while reporting the text. The
// text is tried on a detached field of the same type first, so the page's field, what it shows and its edit state stay
// as they were. Reads go through the native getter, as a page can redefine the value property on its own element.
// Fields that hold a secret never return a value the page put there: the result has the typed text when the field holds
// it, else heldDiffers, as a page that rejects the write may restore what the person typed.
function typedTextScript(): string {
  return `const writeTypedText = (element, value, setter) => {
    if (!setter) return null;
    if (element instanceof HTMLInputElement && value !== ''
      && ['number', 'date', 'time', 'datetime-local', 'month', 'week'].includes(element.type)) {
      const trial = document.createElement('input');
      trial.type = element.type;
      setter.call(trial, value);
      if (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(trial) === '') {
        return { typedText: 'not-accepted', inputType: element.type };
      }
    }
    setter.call(element, value);
    return null;
  };
  const heldText = (element, value) => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : null;
    // An editable region reports the text written, not the rest of its content.
    if (!prototype) return { value };
    const held = Object.getOwnPropertyDescriptor(prototype, 'value').get.call(element);
    const secret = element instanceof HTMLInputElement && (element.type === 'password'
      || /(?:^|\\s)(?:current-password|new-password|one-time-code|cc-\\S+)(?:\\s|$)/i.test(element.getAttribute('autocomplete') || ''));
    if (!secret || held === value) return { value: secret ? value : held };
    return { heldDiffers: true };
  };`
}

export function targetActionScript(
  action: 'click' | 'type' | 'select',
  target: { ref?: string; selector?: string },
  text?: string,
  submit?: boolean
): string {
  const encodedTarget = JSON.stringify(target)
  const encodedText = JSON.stringify(text ?? '')
  return `(() => {
    const target = ${encodedTarget};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    ${action !== 'click' ? nativeEditabilityScript() + nativeEditabilityGuardScript() : ''}
    ${action === 'type' ? typedTextScript() : ''}
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    element.focus();
    if (${JSON.stringify(action)} === 'click') {
      ${nativeDisabledClickGuardScript()}
      element.click();
      return { ok: true, tag: element.tagName.toLowerCase() };
    }
    ${action !== 'click' ? nativeEditabilityGuardScript() : ''}
    const value = ${encodedText};
    if (${JSON.stringify(action)} === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('Target is not a select element.');
      const option = [...element.options].find((candidate) => candidate.value === value || candidate.label === value || candidate.text === value);
      if (!option) throw new Error('Select option not found: ' + value);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      ${nativeEditabilityGuardScript()}
      setter?.call(element, option.value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, tag: 'select', value: option.value, label: option.label || option.text };
    }
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      ${nativeEditabilityGuardScript()}
      { const refused = writeTypedText(element, value, setter); if (refused) return refused; }
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      ${nativeEditabilityGuardScript()}
      { const refused = writeTypedText(element, value, setter); if (refused) return refused; }
    } else if (element.isContentEditable) {
      ${nativeEditabilityGuardScript()}
      element.textContent = value;
    } else {
      throw new Error('Target is not an editable element.');
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    // What the field holds once the page's own input and change handlers that run at once have formatted it.
    const held = heldText(element, value);
    if (${Boolean(submit)}) {
      const form = element.closest('form');
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
      else element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { ok: true, tag: element.tagName.toLowerCase(), ...held };
  })()`
}

function dialogOverridesScript(action: 'accept' | 'dismiss', promptText?: string): string {
  return `
    const originalDialogs = Object.fromEntries(
      ['alert', 'confirm', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)])
    );
    const accept = ${action === 'accept'};
    const hasPromptText = ${promptText !== undefined};
    const promptResponse = ${JSON.stringify(promptText ?? '')};
    Object.defineProperties(window, {
      alert: {
        configurable: true,
        writable: true,
        value: function () { return undefined; }
      },
      confirm: {
        configurable: true,
        writable: true,
        value: function () { return accept; }
      },
      prompt: {
        configurable: true,
        writable: true,
        value: function (_message, defaultValue) {
          if (!accept) return null;
          if (hasPromptText) return promptResponse;
          return arguments.length > 1 ? String(defaultValue) : '';
        }
      }
    });
    const restoreDialogs = function () {
      for (const name of ['alert', 'confirm', 'prompt']) {
        const descriptor = originalDialogs[name];
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else delete window[name];
      }
    };`
}

export function dialogAwareClickScript(
  target: { ref?: string; selector?: string },
  action: 'accept' | 'dismiss',
  promptText?: string
): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    element.focus();
    ${dialogOverridesScript(action, promptText)}
    try {
      ${nativeDisabledClickGuardScript()}
      element.click();
      return { ok: true, tag: element.tagName.toLowerCase() };
    } finally {
      restoreDialogs();
    }
  })()`
}

export function dialogAwareCoordinateClickScript(
  point: { x: number; y: number },
  action: 'accept' | 'dismiss',
  promptText?: string
): string {
  return `(() => {
    const point = ${JSON.stringify(point)};
    const element = document.elementFromPoint(point.x, point.y);
    if (!(element instanceof Element)) throw new Error('No element exists at the requested viewport coordinates.');
    if (element instanceof HTMLElement) element.focus();
    ${dialogOverridesScript(action, promptText)}
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
      }));
      return { ok: true, tag: element.tagName.toLowerCase(), x: point.x, y: point.y };
    } finally {
      restoreDialogs();
    }
  })()`
}

/**
 * Page code that ends one evaluation's dialog handling, by its id, also for an
 * evaluation whose call stopped waiting while its script still runs. When no
 * evaluation still handles dialogs, the page's own alert, confirm and prompt
 * come back.
 */
export function releaseEvaluationDialogsScript(id: string): string {
  return `(() => {
    const state = window[Symbol.for('hronaut.evaluationDialogs')];
    if (!state) return;
    state.active = state.active.filter((entry) => entry.id !== ${JSON.stringify(id)});
    if (state.active.length) return;
    for (const name of ['alert', 'confirm', 'prompt']) {
      const descriptor = state.originals[name];
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else delete window[name];
    }
    delete window[Symbol.for('hronaut.evaluationDialogs')];
  })()`
}

/**
 * Runs the script with the page's dialogs answered as asked until it settles.
 * Evaluations that overlap, such as one still running after its call stopped
 * waiting, share one set of handlers that follows the latest evaluation and
 * keep the page's own dialogs to restore when the last one ends.
 */
export function dialogAwareEvaluateScript(
  script: string,
  action: 'accept' | 'dismiss',
  id: string
): string {
  return `(async () => {
    const key = Symbol.for('hronaut.evaluationDialogs');
    let state = window[key];
    if (!state) {
      state = {
        active: [],
        originals: Object.fromEntries(['alert', 'confirm', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)]))
      };
      Object.defineProperty(window, key, { configurable: true, value: state });
      const accepts = () => state.active.length > 0 && state.active[state.active.length - 1].accept;
      Object.defineProperties(window, {
        alert: { configurable: true, writable: true, value: function () { return undefined; } },
        confirm: { configurable: true, writable: true, value: function () { return accepts(); } },
        prompt: {
          configurable: true,
          writable: true,
          value: function (_message, defaultValue) {
            if (!accepts()) return null;
            return arguments.length > 1 ? String(defaultValue) : '';
          }
        }
      });
    }
    state.active.push({ id: ${JSON.stringify(id)}, accept: ${action === 'accept'} });
    try {
      return await (0, eval)(${JSON.stringify(script)});
    } finally {
      ${releaseEvaluationDialogsScript(id)};
    }
  })()`
}

export function targetExpression(target: { ref?: string; selector?: string }): string {
  const encodedTarget = JSON.stringify(target)
  return `(() => {
    const target = ${encodedTarget};
    return target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
  })()`
}

export function targetStateScript(
  target: { ref?: string; selector?: string },
  state: 'attached' | 'detached' | 'visible' | 'hidden'
): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const state = ${JSON.stringify(state)};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    const attached = element instanceof Element && element.isConnected;
    let visible = false;
    if (attached) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      visible = style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && rect.width > 0
        && rect.height > 0;
    }
    return {
      matches: state === 'attached' ? attached
        : state === 'detached' ? !attached
        : state === 'visible' ? visible
        : !visible
    };
  })()`
}

export interface BrowserFormField {
  ref?: string
  selector?: string
  value: string | boolean
}

export function fillFormScript(fields: BrowserFormField[]): string {
  return `(() => {
    const fields = ${JSON.stringify(fields)};
    const resolve = (target) => target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    const results = [];
    ${typedTextScript()}
    for (const [index, field] of fields.entries()) {
      const result = (() => {
        const element = resolve(field);
        // Markers, not thrown errors: main names the fields already filled, and executeJavaScript may drop a thrown message.
        if (!element) return { formField: 'missing' };
        ${nativeEditabilityScript()}
        ${nativeEditabilityGuardScript()}
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        element.focus();
        ${nativeEditabilityGuardScript()}
        if (element instanceof HTMLSelectElement) {
          const value = String(field.value);
          const option = [...element.options].find((candidate) => candidate.value === value || candidate.label === value || candidate.text === value);
          if (!option) return { formField: 'option-not-found', option: value };
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          ${nativeEditabilityGuardScript()}
          setter?.call(element, option.value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { index, tag: 'select', value: option.value, label: option.label || option.text };
        }
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
          const checked = typeof field.value === 'boolean' ? field.value : field.value === 'true';
          ${nativeEditabilityGuardScript()}
          if (element.checked !== checked) element.click();
          return { index, tag: 'input', type: element.type, checked: element.checked };
        }
        const value = String(field.value);
        if (element instanceof HTMLInputElement) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          ${nativeEditabilityGuardScript()}
          { const refused = writeTypedText(element, value, setter); if (refused) return refused; }
        } else if (element instanceof HTMLTextAreaElement) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          ${nativeEditabilityGuardScript()}
          { const refused = writeTypedText(element, value, setter); if (refused) return refused; }
        } else if (element.isContentEditable) {
          ${nativeEditabilityGuardScript()}
          element.textContent = value;
        } else {
          return { formField: 'not-editable' };
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { index, tag: element.tagName.toLowerCase(), ...heldText(element, value) };
      })();
      if (result.nativeEditability || result.typedText || result.formField) return { ...result, fieldIndex: index + 1 };
      results.push(result);
    }
    return results;
  })()`
}

export function targetPointScript(
  target: { ref?: string; selector?: string },
  options: { rejectNativeDisabled?: boolean } = {}
): string {
  return `(() => {
    const element = ${targetExpression(target)};
    if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Element has no visible bounds.');
    ${options.rejectNativeDisabled ? nativeDisabledClickGuardScript() : ''}
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: element.tagName.toLowerCase() };
  })()`
}

export function dragPointsScript(
  source: { ref?: string; selector?: string },
  target: { ref?: string; selector?: string }
): string {
  return `(() => {
    const source = ${targetExpression(source)};
    const target = ${targetExpression(target)};
    if (!source || !target) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    source.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    // Destination scrolling can move the source. Measure both only after all
    // scrolling, in one evaluation, so native input uses one viewport.
    const point = (element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error('Element has no visible bounds.');
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: element.tagName.toLowerCase() };
    };
    return { from: point(source), to: point(target) };
  })()`
}
