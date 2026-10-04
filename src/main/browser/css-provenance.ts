import type { WebContents } from 'electron'
import {
  CSS_PROVENANCE_LIMITS, cssSourceHeader, normalizeCssProvenance,
  type CssInspectionProperty, type CssSourceHeader
} from '../../shared/css-provenance.js'
import type { BrowserCssProvenance } from '../../shared/types.js'

// Called inside TabsManager's debugger queue. Never attach/detach, evaluate page
// code, retrieve stylesheet bodies, force pseudo states, or modify style/DOM.
export async function collectCssProvenance<T>(
  contents: WebContents,
  selector: string,
  properties: CssInspectionProperty[],
  assertCurrent: () => void,
  keepDomEnabled: boolean,
  inspect: () => Promise<T>
): Promise<{ provenance: BrowserCssProvenance; inspection: T }> {
  const headers = new Map<string, CssSourceHeader>()
  let headersTruncated = false
  let revision = 0
  let cssEnabled = false
  const listener = (_event: Electron.Event, method: string, params: unknown): void => {
    if (method === 'CSS.styleSheetAdded') {
      const header = (params as { header?: { styleSheetId?: string } }).header
      if (header?.styleSheetId) {
        if (headers.size < CSS_PROVENANCE_LIMITS.headers || headers.has(header.styleSheetId)) headers.set(header.styleSheetId, cssSourceHeader(header))
        else headersTruncated = true
      }
    }
    if (['CSS.styleSheetAdded', 'CSS.styleSheetChanged', 'CSS.styleSheetRemoved', 'CSS.mediaQueryResultChanged',
      'DOM.attributeModified', 'DOM.attributeRemoved', 'DOM.childNodeRemoved', 'DOM.childNodeInserted', 'DOM.documentUpdated'].includes(method)) revision++
  }
  const command = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    assertCurrent()
    const result = await contents.debugger.sendCommand(method, params)
    assertCurrent()
    return result as Record<string, unknown>
  }
  contents.debugger.on('message', listener)
  try {
    await command('DOM.enable')
    cssEnabled = true
    await command('CSS.enable')
    const document = await command('DOM.getDocument', { depth: 0, pierce: false }) as { root: { nodeId: number } }
    const find = () => command('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector }) as Promise<{ nodeIds: number[] }>
    const nodes = await find()
    if (nodes.nodeIds.length !== 1) throw new Error('CSS provenance requires exactly one matching top-level element. Take a fresh snapshot or use a unique selector.')
    const nodeId = nodes.nodeIds[0]!
    const capturedRevision = revision
    const matched = await command('CSS.getMatchedStylesForNode', { nodeId })
    const computed = await command('CSS.getComputedStyleForNode', { nodeId })
    const inspection = await inspect()
    assertCurrent()
    const current = await find()
    if (current.nodeIds.length !== 1 || current.nodeIds[0] !== nodeId || revision !== capturedRevision) {
      throw new Error('The element or stylesheet changed during CSS provenance inspection. Inspect it again.')
    }
    return { provenance: normalizeCssProvenance({ properties, matched, computed, headers, headersTruncated }), inspection }
  } finally {
    contents.debugger.removeListener('message', listener)
    if (!contents.isDestroyed() && contents.debugger.isAttached()) {
      if (cssEnabled) await contents.debugger.sendCommand('CSS.disable').catch(() => undefined)
      if (!keepDomEnabled) await contents.debugger.sendCommand('DOM.disable').catch(() => undefined)
    }
  }
}
