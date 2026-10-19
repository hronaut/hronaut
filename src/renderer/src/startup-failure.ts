import { translate, type MessageKey } from '../../shared/i18n.js'
import { resolveSupportedLocale, type SupportedLocale } from '../../shared/locale.js'

function startupErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return (message || fallback).slice(0, 1_000)
}

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className?: string): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/**
 * The page shown when the shell cannot load its settings. Without them the chosen language is unknown, so it speaks
 * the operating system's language when Hronaut has it, and English otherwise.
 */
export function renderStartupFailure(
  root: HTMLElement,
  error: unknown,
  retry: () => void = () => window.location.reload(),
  locale: SupportedLocale = resolveSupportedLocale(navigator.language)
): void {
  const text = (key: MessageKey): string => translate(locale, key)
  document.documentElement.lang = locale
  document.documentElement.dir = 'ltr'

  const panel = element('main', 'startup-failure')
  panel.setAttribute('role', 'alert')
  panel.setAttribute('aria-labelledby', 'startup-failure-title')

  const brand = element('div', 'startup-failure-brand')
  const brandMark = element('span', 'startup-failure-mark')
  brandMark.textContent = 'H'
  brandMark.setAttribute('aria-hidden', 'true')
  const brandName = element('span')
  brandName.textContent = 'HRONAUT'
  brand.append(brandMark, brandName)

  const copy = element('div', 'startup-failure-copy')
  const heading = element('h1')
  heading.id = 'startup-failure-title'
  heading.textContent = text('appErrors.startupScreen.title')
  const description = element('p')
  description.textContent = text('appErrors.startupScreen.description')
  const details = element('code')
  details.textContent = startupErrorMessage(error, text('appErrors.startupScreen.settingsUnavailable'))
  copy.append(heading, description, details)

  const action = element('button', 'startup-failure-retry')
  action.type = 'button'
  action.textContent = text('appErrors.startupScreen.retry')
  action.addEventListener('click', retry, { once: true })

  const privacy = element('small')
  privacy.textContent = text('appErrors.startupScreen.privacy')
  panel.append(brand, copy, action, privacy)
  root.replaceChildren(panel)
  action.focus()
}
