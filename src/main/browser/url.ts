import { DEFAULT_SEARCH_ENGINE, searchUrl, type SearchEngineName } from '../../shared/search-engine.js'
export { isHronautHomeUrl } from '../../shared/home-url.js'

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const HOST_LIKE_PATTERN = /^(localhost\.?|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#].*)?$/i
// A one-word host name with a port, such as a Tailscale MagicDNS name or a LAN machine (`devbox:3000`), reads like a
// scheme followed by a value. As in Chrome, a colon followed only by digits names a port. The name starts with a
// letter, as a scheme does: `16:9` or `10:30` stays a search rather than an address the URL parser reads as a number.
const SINGLE_LABEL_HOST_WITH_PORT = /^([a-z](?:[a-z\d_-]*[a-z\d])?):\d{1,5}(?:[/?#].*)?$/i
// Links whose whole value can be a short number, such as `tel:911` or a SIP extension, stay links. A web scheme such as
// `http:3000` stays as typed too, so the address an agent's capability profile checks is the one the tab loads.
const KEPT_SCHEMES: ReadonlySet<string> = new Set([
  'callto', 'facetime', 'facetime-audio', 'fax', 'mms', 'sip', 'sips', 'sms', 'tel',
  'ftp', 'http', 'https', 'ws', 'wss'
])

function isLoopbackAddress(value: string): boolean {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLocaleLowerCase().replace(/\.$/, '')
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  } catch {
    return false
  }
}

/**
 * Whether a scheme-less address names a device on the local network rather than a public site: a private, shared
 * (100.64.0.0/10, as Tailscale uses), link-local or unspecified IP address, or a `.local`, `.internal`, `.home.arpa`
 * or `.test` name. No public certificate can name these, so a development server's Network address or a router's setup
 * page there serves plain HTTP. The address is classified as the URL parser reads it, so `10.5` counts as `10.0.0.5`.
 */
function isLocalNetworkAddress(value: string): boolean {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLocaleLowerCase().replace(/\.$/, '')
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname)
    if (ipv4) {
      const [first, second] = [Number(ipv4[1]), Number(ipv4[2])]
      return first === 10
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 169 && second === 254)
        || (first === 100 && second >= 64 && second <= 127)
        || hostname === '0.0.0.0'
    }
    return hostname === '[::]'
      || /^\[f[cd][0-9a-f]{2}:/.test(hostname)
      || /^\[fe[89ab][0-9a-f]:/.test(hostname)
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')
      || hostname.endsWith('.home.arpa')
      || hostname.endsWith('.test')
  } catch {
    return false
  }
}

/** Whether a scheme-less address names port 443, which asks for HTTPS wherever the address points. */
function namesHttpsPort(value: string): boolean {
  try {
    return new URL(`http://${value}`).port === '443'
  } catch {
    return false
  }
}

function hasSchemeLessUserInfo(value: string): boolean {
  const authorityEnd = value.search(/[/?#]/)
  const authority = authorityEnd < 0 ? value : value.slice(0, authorityEnd)
  return authority.includes('@')
}

export function isAgentWorkspaceNavigationUrl(value: string): boolean {
  if (value.length === 'about:blank'.length && value.toLowerCase() === 'about:blank') return true
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return !url.username && !url.password
    if (url.protocol === 'data:') return true
    if (url.protocol === 'view-source:') {
      const source = new URL(value.slice('view-source:'.length))
      return (source.protocol === 'http:' || source.protocol === 'https:')
        && !source.username
        && !source.password
    }
    if (url.protocol !== 'blob:') return false
    const source = new URL(value.slice('blob:'.length))
    return (source.protocol === 'http:' || source.protocol === 'https:')
      && !source.username
      && !source.password
  } catch {
    return false
  }
}

/** The address a typed input names, without falling back to a search: undefined when it reads as search terms. */
export function webAddress(input: string): string | undefined {
  const value = input.trim()
  if (!value) return 'about:blank'
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value) || /^(about|data|file|view-source):/i.test(value)) return value
  if (!hasSchemeLessUserInfo(value) && HOST_LIKE_PATTERN.test(value)) {
    const plainHttp = !namesHttpsPort(value) && (isLoopbackAddress(value) || isLocalNetworkAddress(value))
    const candidate = `${plainHttp ? 'http' : 'https'}://${value}`
    try {
      new URL(candidate)
      return candidate
    } catch {
      return undefined
    }
  }
  const singleLabelHost = SINGLE_LABEL_HOST_WITH_PORT.exec(value)?.[1]
  if (singleLabelHost && !KEPT_SCHEMES.has(singleLabelHost.toLowerCase())) {
    // A one-word name is never a public site, so it opens over HTTP unless it names port 443.
    const candidate = `${namesHttpsPort(value) ? 'https' : 'http'}://${value}`
    return URL.canParse(candidate) ? candidate : undefined
  }
  if (SCHEME_PATTERN.test(value)) return value
  return undefined
}

export function normalizeAddress(input: string, searchEngine: SearchEngineName = DEFAULT_SEARCH_ENGINE): string {
  return webAddress(input) ?? searchUrl(input.trim(), searchEngine)
}

export function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
