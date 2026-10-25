/**
 * Secure DNS, as in Chrome's Settings > Privacy and security > Security > Use secure DNS: website addresses are looked up
 * over an encrypted connection (DNS over HTTPS). Automatic, the default, uses it when the current DNS service offers it
 * and falls back to plain DNS; Secure looks up every address through the chosen provider only; Off uses plain DNS. Names
 * in the hosts file, localhost and IP addresses keep working in every mode.
 */
export const SECURE_DNS_MODES = ['automatic', 'secure', 'off'] as const
export type SecureDnsMode = (typeof SECURE_DNS_MODES)[number]

export const DEFAULT_SECURE_DNS_MODE: SecureDnsMode = 'automatic'
export const SECURE_DNS_TEMPLATE_MAX_LENGTH = 2_048

export interface SecureDnsProvider {
  id: string
  /** The provider's own name, which is not translated. */
  label: string
  /** The provider's DNS over HTTPS address, as it documents it. */
  template: string
}

export const SECURE_DNS_PROVIDERS: readonly SecureDnsProvider[] = [
  { id: 'cloudflare', label: 'Cloudflare (1.1.1.1)', template: 'https://cloudflare-dns.com/dns-query' },
  { id: 'google', label: 'Google (Public DNS)', template: 'https://dns.google/dns-query{?dns}' },
  { id: 'quad9', label: 'Quad9 (9.9.9.9)', template: 'https://dns.quad9.net/dns-query' }
]

export function isSecureDnsMode(value: unknown): value is SecureDnsMode {
  return typeof value === 'string' && SECURE_DNS_MODES.includes(value as SecureDnsMode)
}

/**
 * Whether the text is a DNS over HTTPS address Chromium takes (RFC 8484): an https address without a user name or a
 * fragment, ending in {?dns} for a provider that is asked with GET. The text is trimmed first.
 */
export function isSecureDnsTemplate(text: string): boolean {
  const template = text.trim()
  if (!template || template.length > SECURE_DNS_TEMPLATE_MAX_LENGTH || /\s/u.test(template)) return false
  const address = template.endsWith('{?dns}') ? template.slice(0, -'{?dns}'.length) : template
  if (/[{}]/u.test(address)) return false
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

/**
 * The saved setting as main applies it: a known mode, and the provider's address trimmed, or empty when it is not one.
 * Secure without a provider to ask would look up nothing, so it reads as Automatic.
 */
export function readSecureDns(mode: unknown, template: unknown): { secureDnsMode: SecureDnsMode; secureDnsTemplate: string } {
  const secureDnsTemplate = typeof template === 'string' && isSecureDnsTemplate(template) ? template.trim() : ''
  const secureDnsMode = isSecureDnsMode(mode) && (mode !== 'secure' || secureDnsTemplate) ? mode : DEFAULT_SECURE_DNS_MODE
  return { secureDnsMode, secureDnsTemplate }
}
