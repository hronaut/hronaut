function startupErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return (message || 'The renderer settings service is unavailable.').slice(0, 1_000)
}

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className?: string): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

export function renderStartupFailure(
  root: HTMLElement,
  error: unknown,
  retry: () => void = () => window.location.reload()
): void {
  document.documentElement.lang = 'en'
  document.documentElement.dir = 'ltr'

  const panel = element('main', 'startup-failure')
  panel.setAttribute('role', 'alert')
  panel.setAttribute('aria-labelledby', 'startup-failure-title')

  const brand = element('div', 'startup-failure-brand')
  const brandMark = element('span', 'startup-failure-mark')
  brandMark.textContent = 'B'
  brandMark.setAttribute('aria-hidden', 'true')
  const brandName = element('span')
  brandName.textContent = 'HRONAUT'
  brand.append(brandMark, brandName)

  const copy = element('div', 'startup-failure-copy')
  const heading = element('h1')
  heading.id = 'startup-failure-title'
  heading.textContent = 'Hronaut could not start'
  const description = element('p')
  description.textContent = 'The application shell could not load its initial settings.'
  const details = element('code')
  details.textContent = startupErrorMessage(error)
  copy.append(heading, description, details)

  const action = element('button', 'startup-failure-retry')
  action.type = 'button'
  action.textContent = 'Try again'
  action.addEventListener('click', retry, { once: true })

  const privacy = element('small')
  privacy.textContent = 'Your browser profile remains on this device.'
  panel.append(brand, copy, action, privacy)
  root.replaceChildren(panel)
  action.focus()
}
