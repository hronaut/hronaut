/**
 * How the address bar describes a website's connection, as Chrome does: an HTTPS page is secure; an HTTP page on this
 * computer (`localhost`, a `.localhost` name, `127.0.0.0/8` or `[::1]`), which browsers treat as a secure context, is
 * local; any other HTTP page is not secure. Hronaut loads no HTTPS page whose certificate fails, so the scheme decides.
 */
export type AddressSecurity = 'secure' | 'local' | 'not-secure'

/** The connection of a website's address, or null for an address that is not http or https. */
export function addressSecurity(address: string | null | undefined): AddressSecurity | null {
  let url: URL
  try {
    url = new URL(address ?? '')
  } catch {
    return null
  }
  if (url.protocol === 'https:') return 'secure'
  if (url.protocol !== 'http:') return null
  return isLocalHost(url.hostname) ? 'local' : 'not-secure'
}

/** Chromium's localhost: the name `localhost` or one under it, with or without a closing dot, or a loopback address. */
function isLocalHost(hostname: string): boolean {
  const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  return name === 'localhost' || name.endsWith('.localhost') || name === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(name)
}
