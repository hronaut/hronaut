import { AGENT_READINESS_MAX_FILE_BYTES, type AgentReadinessFile, type AgentReadinessSources } from '../../../shared/agent-readiness.js'
import { pageScript } from '../../../shared/page-script.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { listWebMcpTools } from '../webmcp/webmcp.js'
import { countWebMcpForms } from './agent-readiness.page.js'

const FETCH_TIMEOUT_MS = 5_000

/**
 * Reads one file of the page's origin through the tab's session, so its proxy and certificate rules apply, but
 * without cookies or other credentials, as a crawler would. (CDP's Network.loadNetworkResource still sends the
 * page's cookies to its own origin.) A 4xx other than 429 means nothing is there; anything else that is not a 2xx is
 * a failure. A file over the limit is cut at it.
 */
async function fetchFile(tab: BrowserTab, url: string): Promise<AgentReadinessFile> {
  try {
    const response = await tab.webContents.session.fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return response.status >= 400 && response.status < 500 && response.status !== 429 ? { status: 'missing' } : { status: 'failed' }
    }
    const reader = response.body?.getReader()
    if (!reader) return { status: 'found', text: '' }
    const chunks: Buffer[] = []
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const room = AGENT_READINESS_MAX_FILE_BYTES - bytes
      chunks.push(Buffer.from(value.subarray(0, room)))
      bytes += Math.min(value.byteLength, room)
      if (bytes >= AGENT_READINESS_MAX_FILE_BYTES) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
    return { status: 'found', text: Buffer.concat(chunks).toString('utf8') }
  } catch {
    return { status: 'failed' }
  }
}

/**
 * Collects what the quality audit's agent readiness category judges: the page's WebMCP tools and annotated forms,
 * and its origin's /llms.txt and /.well-known/ard.json, read without cookies.
 */
export async function collectAgentReadiness(browser: Browser, tab: BrowserTab): Promise<AgentReadinessSources> {
  const page = new URL(tab.url)
  const listing = await listWebMcpTools(browser, tab.id).catch(() => undefined)
  const webMcpTools = listing && 'tools' in listing && Array.isArray(listing.tools) ? listing.tools.length : null
  const forms = await tab.webContents.executeJavaScript(pageScript(countWebMcpForms), false)
    .then((value: { forms?: unknown; unannotated?: unknown }) => ({
      forms: Number.isSafeInteger(value?.forms) ? Number(value.forms) : 0,
      unannotated: Number.isSafeInteger(value?.unannotated) ? Number(value.unannotated) : 0
    }), () => ({ forms: 0, unannotated: 0 }))
  const sources = { webMcpTools, forms: forms.forms, unannotatedForms: forms.unannotated }
  // A file, data or about page has no origin to ask for well-known files.
  if (page.protocol !== 'http:' && page.protocol !== 'https:') {
    return { ...sources, llmsTxt: { status: 'unchecked' }, ardManifest: { status: 'unchecked' } }
  }
  const [llmsTxt, ardManifest] = await Promise.all([
    fetchFile(tab, `${page.origin}/llms.txt`),
    fetchFile(tab, `${page.origin}/.well-known/ard.json`)
  ])
  return { ...sources, llmsTxt, ardManifest }
}
