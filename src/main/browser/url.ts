import { DEFAULT_SEARCH_ENGINE, searchUrl, type SearchEngineName } from '../../shared/search-engine.js'
import { TOP_LEVEL_DOMAINS } from './top-level-domains.js'
export { isHronautHomeUrl } from '../../shared/home-url.js'

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const HOST_LIKE_PATTERN = /^(localhost\.?|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#].*)?$/i
// A number with two or three parts, such as `3.14`, `1.2.3` or `22.5/7`, is a search, as in Chrome, rather than a
// short IPv4 address the URL parser reads as `3.0.0.14`, a server on the internet. `rest` is what follows the number.
const SHORT_DOTTED_NUMBER = /^\d+(?:\.\d+){1,2}\.?(?<rest>(?::\d+)?(?:[/?#].*)?)$/
// A one-word host name with a port, such as a Tailscale MagicDNS name or a LAN machine (`devbox:3000`), reads like a
// scheme followed by a value. As in Chrome, a colon followed only by digits names a port. The name starts with a
// letter, as a scheme does: `16:9` or `10:30` stays a search rather than an address the URL parser reads as a number.
const SINGLE_LABEL_HOST_WITH_PORT = /^([a-z](?:[a-z\d_-]*[a-z\d])?):\d{1,5}(?:[/?#].*)?$/i
// A one-word host name followed by a path that ends in a slash, such as `intranet/` or `go/docs/`, or by two of a path,
// a query and a fragment, such as `wiki/page?id=4`, names a machine on the local network, as in Chrome. A word alone, or
// one with only a path, a query or a fragment after it, such as `and/or` or `why?`, is a search.
const SINGLE_LABEL_HOST_WITH_PATH = /^[a-z](?:[a-z\d_-]*[a-z\d])?(?<path>\/[^?#\s]*)?(?<query>\?[^#\s]*)?(?<fragment>#\S*)?$/i
// The names Chrome opens as addresses although their last part is no top-level domain, with a name before it: the
// special-use `.example`, `.test` and `.onion`, `.local` for Multicast DNS and `.internal`, reserved for private use.
const SPECIAL_USE_DOMAINS = ['example', 'test', 'onion', 'local', 'internal']
// The page whose source `view-source:` shows, which Chrome reads as a typed address, so `view-source:example.com` works.
const VIEW_SOURCE = /^view-source:(?<page>.*)$/is
// Links whose whole value can be a short number, such as `tel:911` or a SIP extension, stay links. A web scheme such as
// `http:3000` stays as typed too, so the address an agent's capability profile checks is the one the tab loads.
const KEPT_SCHEMES: ReadonlySet<string> = new Set([
  'callto', 'facetime', 'facetime-audio', 'fax', 'mms', 'sip', 'sips', 'sms', 'tel',
  'ftp', 'http', 'https', 'ws', 'wss'
])
// Schemes whose links may be typed with spaces, such as a phone number or an email's subject. Text with spaces after
// any other word and a colon is search terms, as in Chrome: a `site:` search, or an error message such as
// `TypeError: x is undefined`, which was refused as an address of an unknown scheme instead.
const SCHEMES_TYPED_WITH_SPACES: ReadonlySet<string> = new Set([...KEPT_SCHEMES, 'mailto', 'javascript'])

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

/**
 * Whether a number with two or three parts reads as search terms. As in Chrome, a trailing slash (`1.2/`) makes it an
 * address. Unlike Chrome, a port or path also does when the number names a loopback or local network address, such as
 * `10.5:3000` or `127.1/admin`, so a development server's short address keeps working; it never reaches the internet.
 * The URL parser maps full-width digits to ASCII ones, so the check reads the input the same way.
 */
function isShortNumberSearch(value: string): boolean {
  const rest = SHORT_DOTTED_NUMBER.exec(value.normalize('NFKC'))?.groups?.rest
  if (rest === undefined || rest === '/') return false
  return !rest || !(isLoopbackAddress(value) || isLocalNetworkAddress(value))
}

function isSingleLabelHostAddress(value: string): boolean {
  const parts = SINGLE_LABEL_HOST_WITH_PATH.exec(value)?.groups
  if (!parts) return false
  const { path = '', query = '', fragment = '' } = parts
  return path.endsWith('/') || [path, query.slice(1), fragment.slice(1)].filter(Boolean).length > 1
}

// The host name a scheme-less address names, in lowercase and without a trailing dot.
function schemeLessHostname(value: string): string | undefined {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return undefined
  }
}

/**
 * Whether a scheme-less address names a host under no top-level domain, such as `nas.lan` or `node.js`, which no
 * public site, and no public certificate, can have. An IP address and a loopback name are none.
 */
function namesUnknownTopLevelDomain(value: string): boolean {
  const hostname = schemeLessHostname(value)
  if (!hostname || hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(hostname) || isLoopbackAddress(value)) return false
  return !TOP_LEVEL_DOMAINS.has(hostname.slice(hostname.lastIndexOf('.') + 1))
}

/**
 * Whether a scheme-less dotted name reads as search terms, as in Chrome: its last part is no top-level domain, as in
 * `node.js`, `index.html` or `nas.lan`, and nothing after it marks it as an address, which a port does, a path that
 * ends in a slash, as in `nas.lan/`, or two of a path, a query and a fragment. A name under the special-use `.invalid`,
 * which can never be reached, is always searched; the other special-use names stay addresses.
 */
function isUnknownDomainSearch(value: string): boolean {
  if (!namesUnknownTopLevelDomain(value)) return false
  const hostname = schemeLessHostname(value)!
  if (hostname.endsWith('.invalid')) return true
  if (SPECIAL_USE_DOMAINS.some((domain) => hostname.endsWith(`.${domain}`))) return false
  const restAt = value.search(/[/\\?#]/)
  if (/:\d+$/.test(restAt < 0 ? value : value.slice(0, restAt))) return false
  const rest = /^(?<path>[/\\][^?#]*)?(?<query>\?[^#]*)?(?<fragment>#.*)?$/s.exec(restAt < 0 ? '' : value.slice(restAt))?.groups
  if (!rest) return false
  const { path = '', query = '', fragment = '' } = rest
  return !/[/\\]$/.test(path) && [path, query.slice(1), fragment.slice(1)].filter(Boolean).length < 2
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
  return typedAddress(input, true)
}

// unknownDomainsSearched: a dotted name under no top-level domain is searched, as it is in the address bar, rather
// than after `view-source:`, where Chrome reads any name as a page's address.
function typedAddress(input: string, unknownDomainsSearched: boolean): string | undefined {
  const value = input.trim()
  if (!value) return 'about:blank'
  const viewedPage = VIEW_SOURCE.exec(value)?.groups?.page
  if (viewedPage !== undefined) {
    // As in Chrome, the source of a source page is not an address, so a long chain of them is never read one by one.
    if (/^\s*view-source:/i.test(viewedPage)) return value
    const page = typedAddress(viewedPage, false)
    return page && isWebUrl(page) ? `view-source:${page}` : value
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value) || /^(about|data|file):/i.test(value)) return value
  // A one-word name names a machine on the local network rather than a public site, so it opens over HTTP.
  if (isSingleLabelHostAddress(value)) {
    const candidate = `http://${value}`
    return URL.canParse(candidate) ? candidate : undefined
  }
  if (!hasSchemeLessUserInfo(value) && !isShortNumberSearch(value) && HOST_LIKE_PATTERN.test(value)) {
    // Read as search terms, a name such as `site.invalid:80` is no scheme either.
    if (unknownDomainsSearched && isUnknownDomainSearch(value)) return undefined
    // A name under no top-level domain, which no public certificate can name, opens over HTTP too, as in Chrome.
    const plainHttp = !namesHttpsPort(value)
      && (isLoopbackAddress(value) || isLocalNetworkAddress(value) || namesUnknownTopLevelDomain(value))
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
  const scheme = SCHEME_PATTERN.exec(value)?.[0].slice(0, -1).toLowerCase()
  if (!scheme) return undefined
  // A Windows path, such as `C:\Program Files\app`, never goes to the search engine, even with spaces, and neither does a
  // sign-in typed before a host, such as `admin:pass word@router.local`, whose password would leave the computer.
  const keptWithSpaces = /^[a-z]:[\\/]/i.test(value) || hasSchemeLessUserInfo(value)
  if (/\s/.test(value) && !keptWithSpaces && !SCHEMES_TYPED_WITH_SPACES.has(scheme) && !scheme.startsWith('web+')) return undefined
  return value
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
