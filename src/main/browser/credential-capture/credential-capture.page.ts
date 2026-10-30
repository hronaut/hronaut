import type { BrowserCredentialCandidate } from './credential-capture.js'

/** The flag the watcher keeps on the window of its own world. */
interface CredentialWatcherWindow {
  __hronautCredentialWatcherActive?: boolean
}

/** A username field the watcher remembers until the password step: page-local, never carried into another document or origin. */
interface RememberedAccount {
  field: HTMLInputElement
  value: string
  /** When the field was remembered, on the page's monotonic clock, so that a clock set back or forward neither keeps nor drops it. */
  at: number
  origin: string
}

/**
 * Runs in Hronaut's own isolated world of the page: watches for a submitted sign-in form, once, and gives its
 * credentials, or null when the page goes away first or another watcher is already active.
 */
export function credentialSubmissionInPage(): Promise<BrowserCredentialCandidate | null> {
  return new Promise((resolve) => {
    const scope = window as unknown as CredentialWatcherWindow
    if (scope.__hronautCredentialWatcherActive) { resolve(null); return }
    scope.__hronautCredentialWatcherActive = true
    let remembered: RememberedAccount | null = null
    let finished = false
    const purpose = (input: HTMLInputElement): string | undefined => (input.autocomplete || '').toLowerCase().split(/\s+/)
      .find((token) => ['username', 'current-password', 'new-password', 'one-time-code'].includes(token))
    const usable = (input: unknown): input is HTMLInputElement => input instanceof HTMLInputElement && !input.disabled
      && !input.closest('[hidden], [inert], [aria-hidden="true"]')
    const usernameField = (fields: HTMLInputElement[]): HTMLInputElement | null => {
      const candidates = fields.filter((input) => usable(input)
        && ['text', 'email', 'tel', 'hidden'].includes(input.type)
        && !['one-time-code', 'new-password', 'current-password'].includes(purpose(input)!))
      const explicit = candidates.filter((input) => purpose(input) === 'username')
      if (explicit.length) return explicit.length === 1 ? explicit[0]! : null
      const semantic = candidates.filter((input) => input.type !== 'hidden'
        && (input.type === 'email' || /user|email|login|account|identifier/i.test(input.name + ' ' + input.id)))
      return semantic.length === 1 ? semantic[0]! : null
    }
    // The one value typed in every password field; or, in a form that changes a password, the new password typed twice
    // after the current one, which Chrome saves then: the fields marked new-password, or else the second and third of
    // three, all of them shown. Anything else, such as a confirmation that does not match, offers nothing. A change also
    // gives the current password, with which Chrome finds the saved account a form without a username changes.
    const shown = (input: HTMLInputElement): boolean => (typeof input.checkVisibility !== 'function' || input.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true
    })) && [...input.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)
    const submittedPassword = (passwords: HTMLInputElement[]): { password: string; previous: string } | null => {
      if (new Set(passwords.map((input) => input.value)).size === 1) {
        return { password: (passwords.find((input) => purpose(input) === 'current-password') || passwords[0]!).value, previous: '' }
      }
      if (!passwords.every(shown)) return null
      const fresh = passwords.filter((input) => purpose(input) === 'new-password')
      if (fresh.length && new Set(fresh.map((input) => input.value)).size === 1
        && passwords.every((input) => fresh.includes(input) || purpose(input) === 'current-password')) {
        const current = new Set(passwords.filter((input) => !fresh.includes(input)).map((input) => input.value))
        return { password: fresh[0]!.value, previous: current.size === 1 ? [...current][0]! : '' }
      }
      if (passwords.length === 3 && passwords.every((input) => !purpose(input))
        && passwords[1]!.value === passwords[2]!.value) return { password: passwords[1]!.value, previous: passwords[0]!.value }
      return null
    }
    const fieldsFor = (form: HTMLFormElement | null): HTMLInputElement[] => [...(form ? form.elements : document.querySelectorAll('input'))]
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement && input.form === form)
    const remember = (field: HTMLInputElement | null): void => {
      remembered = field && field.value && field.value.length <= 512
        ? { field, value: field.value, at: performance.now(), origin: location.origin } : null
    }
    const finish = (value: BrowserCredentialCandidate | null): void => {
      if (finished) return
      finished = true
      for (const [type, listener] of listeners) document.removeEventListener(type, listener as EventListener, true)
      window.removeEventListener('pagehide', onPageHide)
      remembered = null
      scope.__hronautCredentialWatcherActive = false
      resolve(value)
    }
    const capture = (form: HTMLFormElement | null): void => {
      const fields = fieldsFor(form)
      const account = usernameField(fields)
      const passwords = fields.filter((input) => usable(input) && !input.readOnly
        && input.type === 'password' && input.value && purpose(input) !== 'one-time-code')
      if (!passwords.length) { remember(account); return }
      const submitted = submittedPassword(passwords)
      if (submitted === null || submitted.password.length > 16384) return
      // An explicit account on this step wins, including an intentionally empty value.
      // Never borrow an account from a different form still present on the page.
      const previous = remembered && remembered.origin === location.origin
        && performance.now() - remembered.at <= 300000
        && (!remembered.field.isConnected || remembered.field.form === form)
        ? remembered.value : ''
      const username = account ? account.value : previous
      if (username.length > 512) return
      // The current password leaves the page only for a change that names no account.
      const previousPassword = !username && submitted.previous.length <= 16384 ? submitted.previous : ''
      finish({ origin: location.origin, username, password: submitted.password, ...previousPassword ? { previousPassword } : {} })
    }
    const onSubmit = (event: Event): void => {
      if (event.target instanceof HTMLFormElement) capture(event.target)
    }
    const onInput = (event: Event): void => {
      const input = event.target
      if (input instanceof HTMLInputElement && usernameField(fieldsFor(input.form)) === input) remember(input)
    }
    const onClick = (event: Event): void => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button, input[type="submit"], [role="button"]') : null
      if (!button || button.matches(':disabled, [aria-disabled="true"]')) return
      const form = (button as HTMLButtonElement).form || button.closest('form')
      const fields = fieldsFor(form)
      if (!fields.some((input) => input.type === 'password')) { remember(usernameField(fields)); return }
      // Native submit buttons are handled by submit (after constraint validation).
      if (form && ((button instanceof HTMLButtonElement || button instanceof HTMLInputElement)
        && button.type === 'submit')) return
      const label = (button.getAttribute('aria-label') || button.textContent || (button as HTMLInputElement).value || '').trim()
      if (/^(log\s*in|sign\s*in|sign\s*up|create\s+(an\s+)?account|register|continue|next|(change|update|set|reset)\s+password)$/i.test(label)) capture(form)
    }
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement
        && event.target.type === 'password' && !event.target.form) capture(null)
    }
    const onPageHide = (): void => finish(null)
    const listeners: Array<[string, (event: never) => void]> = [['submit', onSubmit], ['input', onInput], ['change', onInput], ['click', onClick], ['keydown', onKeydown]]
    for (const [type, listener] of listeners) document.addEventListener(type, listener as EventListener, true)
    window.addEventListener('pagehide', onPageHide, { once: true })
  })
}
