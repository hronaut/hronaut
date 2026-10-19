import type { WebContents } from 'electron'
import {
  COMPUTED_ACCESSIBILITY_CAVEATS,
  COMPUTED_ACCESSIBILITY_IGNORED_REASONS,
  COMPUTED_ACCESSIBILITY_LIMITS,
  COMPUTED_ACCESSIBILITY_STATES,
  type ComputedAccessibilityIgnoredReason,
  type ComputedAccessibilityReport,
  type ComputedAccessibilityState,
  type ComputedAccessibilityStateValue
} from '../../../shared/computed-accessibility.js'
import { RendererExitedError } from '../renderer-exit-guard.js'

interface ComputedAccessibilityTab {
  id: string
  url: string
  observationGeneration: number
  webContents: WebContents
}

/** The calling agent's authority over the tab, checked before Chromium is asked and before the report is returned. */
export interface ComputedAccessibilityAuthority { assertCurrent(): void }

export interface ComputedAccessibilityHost<T> {
  isCurrent(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
  /** Why another use of this debugger session rules the read out, if one does. */
  conflict(tab: T): string | undefined
  /** Whether another use needs the DOM domain to stay enabled afterwards. */
  keepDomEnabled(tab: T): boolean
}

/** The one element to read: a snapshot ref or a CSS selector in the top-level document. */
export interface ComputedAccessibilityTarget {
  ref?: string
  selector?: string
}

/** The part of Chromium's AXNode that Hronaut reads. Everything else in the answer is never read or kept. */
interface AxNode {
  backendDOMNodeId?: unknown
  ignored?: unknown
  ignoredReasons?: unknown
  role?: { value?: unknown }
  properties?: unknown
  name?: { value?: unknown }
  description?: { value?: unknown }
  value?: { value?: unknown }
}

interface TextBound { chars: number; elements: number }

const WORLD_NAME = 'hronaut-computed-accessibility'
const OBJECT_GROUP = 'hronaut-computed-accessibility'
const PAGE_CHANGED = 'The page or the element changed while its computed accessibility was read; read it again'
const TOO_MUCH_TEXT = `The element and the text its name, description and value may draw on exceed ${COMPUTED_ACCESSIBILITY_LIMITS.maxTextChars.toLocaleString('en-US')} characters or ${COMPUTED_ACCESSIBILITY_LIMITS.maxElements.toLocaleString('en-US')} elements, so Hronaut did not ask Chromium; choose a smaller element`
const EXCEEDED_BOUND = 'Chromium computed more text for this element than Hronaut could count in the page, such as text in a closed shadow root or set through a custom element\'s internals, so nothing was returned'
// ARIA role names include hyphenated ones such as doc-chapter and graphics-document.
const ROLE_PATTERN = new RegExp(`^[A-Za-z][A-Za-z0-9-]{0,${COMPUTED_ACCESSIBILITY_LIMITS.maxRoleChars - 1}}$`)
const TOKEN_PATTERN = new RegExp(`^[a-z][A-Za-z-]{0,${COMPUTED_ACCESSIBILITY_LIMITS.maxTokenChars - 1}}$`)
const IGNORED_REASONS = new Set<string>(COMPUTED_ACCESSIBILITY_IGNORED_REASONS)
const STATE_NAMES = Object.keys(COMPUTED_ACCESSIBILITY_STATES) as ComputedAccessibilityState[]
/** Entries read from Chromium's lists at most; real nodes carry a few dozen. */
const MAX_LIST_ENTRIES = 64

/**
 * Counts, in an isolated world, the text Chromium may draw on for the
 * element's name, description and value: its subtree with open shadow trees,
 * text and CDATA, attributes other than class and style, form values,
 * generated content, its labels, and for every element it visits the elements
 * named by aria-labelledby, aria-describedby and aria-owns (as attributes or
 * as element references) and by popover and interest targets. Closed shadow
 * trees and a custom element's internals are out of reach here; the answer is
 * checked against this count afterwards for that reason. It stops counting
 * once either limit is passed.
 */
const TEXT_BOUND_FUNCTION = `function (maxChars, maxElements) {
  let chars = 0, elements = 0
  const seen = new Set([this]), stack = [this]
  const add = node => { if (node && !seen.has(node)) { seen.add(node); stack.push(node) } }
  for (const label of this.labels || []) add(label)
  while (stack.length && chars <= maxChars && elements <= maxElements) {
    const node = stack.pop()
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) { chars += node.data.length; continue }
    if (node.nodeType === Node.ELEMENT_NODE) {
      elements++
      for (const attribute of node.attributes) if (attribute.name !== 'class' && attribute.name !== 'style') chars += attribute.value.length
      if (typeof node.value === 'string') chars += node.value.length
      for (const pseudo of ['::before', '::after', '::marker']) {
        const content = getComputedStyle(node, pseudo).content
        if (content && content !== 'none' && content !== 'normal') chars += content.length
      }
      if (node.shadowRoot) add(node.shadowRoot)
      const root = node.getRootNode()
      for (const name of ['aria-labelledby', 'aria-describedby', 'aria-owns']) {
        for (const id of (node.getAttribute(name) || '').split(/\\s+/)) if (id && root.getElementById) add(root.getElementById(id))
      }
      for (const property of ['ariaLabelledByElements', 'ariaDescribedByElements', 'ariaOwnsElements']) for (const element of node[property] || []) add(element)
      add(node.popoverTargetElement)
      add(node.interestForElement)
    } else if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) continue
    for (const child of node.childNodes) add(child)
  }
  return { chars, elements }
}`

function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/** The CSS selector for the target: a ref matches the attribute snapshots set, escaped character by character. */
function targetSelector(target: ComputedAccessibilityTarget): string {
  const ref = target.ref?.trim(), selector = target.selector?.trim()
  if (Boolean(ref) === Boolean(selector)) throw new Error('Provide exactly one of ref or selector')
  if (ref) {
    if (ref.length > COMPUTED_ACCESSIBILITY_LIMITS.maxRefChars) throw new Error(`A ref has at most ${COMPUTED_ACCESSIBILITY_LIMITS.maxRefChars} characters`)
    return '[data-hronaut-ref="' + Array.from(ref, character => '\\' + character.codePointAt(0)!.toString(16) + ' ').join('') + '"]'
  }
  if (selector!.length > COMPUTED_ACCESSIBILITY_LIMITS.maxSelectorChars) {
    throw new Error(`A selector has at most ${COMPUTED_ACCESSIBILITY_LIMITS.maxSelectorChars} characters`)
  }
  return selector!
}

function readBound(response: unknown): TextBound {
  const value = (response as { result?: { value?: unknown } } | undefined)?.result?.value as { chars?: unknown; elements?: unknown } | undefined
  const count = (number: unknown): number | undefined => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : undefined
  const chars = count(value?.chars), elements = count(value?.elements)
  if (chars === undefined || elements === undefined) throw new Error('Hronaut could not count the element\'s text in the page')
  return { chars, elements }
}

/**
 * Whether each text Chromium computed fits what the page count saw: the name,
 * description and value, and every text-valued property, checked one by one
 * since Chromium can use the same text for more than one of them. Separators
 * join the parts it draws on. Only lengths are read; nothing is copied.
 */
export function withinBound(node: AxNode, bound: TextBound): boolean {
  const most = bound.chars + 2 * bound.elements + 256
  const fits = (value: unknown): boolean => typeof value !== 'string' || value.length <= most
  const properties = Array.isArray(node.properties) ? node.properties.slice(0, MAX_LIST_ENTRIES) : []
  return fits(node.name?.value) && fits(node.description?.value) && fits(node.value?.value)
    && properties.every(property => fits((property as { value?: { value?: unknown } } | null)?.value?.value))
}

function stateValue(type: string, value: { type?: unknown; value?: unknown } | undefined): ComputedAccessibilityStateValue | undefined {
  const raw = value?.value
  switch (type) {
    case 'boolean':
      // Chromium 152 sends some booleans, such as busy, as 1 or 0.
      return (value?.type === 'boolean' || value?.type === 'booleanOrUndefined') && (typeof raw === 'boolean' || raw === 0 || raw === 1)
        ? Boolean(raw) : undefined
    case 'tristate':
      return value?.type === 'tristate' && (typeof raw === 'boolean' || raw === 'mixed') ? raw
        : value?.type === 'tristate' && (raw === 'true' || raw === 'false') ? raw === 'true' : undefined
    case 'token':
      return value?.type === 'token' && typeof raw === 'string' && TOKEN_PATTERN.test(raw) ? raw : undefined
    case 'integer':
      return value?.type === 'integer' && typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : undefined
    default:
      return undefined
  }
}

/**
 * Projects Chromium's node onto the allowlisted fields. Only the role, the
 * ignored flag, the reason codes and allowlisted state values are read; names,
 * descriptions, values, sources, related nodes and identifiers are not.
 */
export function projectComputedAccessibility(node: AxNode): Pick<ComputedAccessibilityReport, 'role' | 'ignored' | 'ignoredReasons' | 'otherIgnoredReasons' | 'states' | 'notReported' | 'unsupported'> {
  const role = typeof node.role?.value === 'string' && ROLE_PATTERN.test(node.role.value) ? node.role.value : 'unknown'
  const ignoredReasons: ComputedAccessibilityIgnoredReason[] = []
  let otherIgnoredReasons = 0
  for (const reason of Array.isArray(node.ignoredReasons) ? node.ignoredReasons.slice(0, MAX_LIST_ENTRIES) : []) {
    const name = (reason as { name?: unknown } | null)?.name
    if (typeof name === 'string' && IGNORED_REASONS.has(name)) {
      if (!ignoredReasons.includes(name as ComputedAccessibilityIgnoredReason)) ignoredReasons.push(name as ComputedAccessibilityIgnoredReason)
    } else otherIgnoredReasons++
  }
  const states: ComputedAccessibilityReport['states'] = {}
  const unsupported: ComputedAccessibilityState[] = []
  for (const property of Array.isArray(node.properties) ? node.properties.slice(0, MAX_LIST_ENTRIES) : []) {
    const name = (property as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || !Object.hasOwn(COMPUTED_ACCESSIBILITY_STATES, name)) continue
    const state = name as ComputedAccessibilityState
    if (state in states || unsupported.includes(state)) continue
    const value = stateValue(COMPUTED_ACCESSIBILITY_STATES[state], (property as { value?: { type?: unknown; value?: unknown } }).value)
    if (value === undefined) unsupported.push(state)
    else states[state] = value
  }
  return {
    role,
    ignored: node.ignored === true,
    ignoredReasons,
    otherIgnoredReasons,
    states,
    notReported: STATE_NAMES.filter(state => !(state in states) && !unsupported.includes(state)),
    unsupported
  }
}

/**
 * Reads Chromium's computed role, ignored reasons and allowlisted states for
 * one element of a tab's top-level document. Chromium's answer also carries
 * the element's computed name, description and value; they stay in this
 * function's turn and are never logged, kept or returned. Before asking,
 * Hronaut counts in the page the text Chromium could draw on and refuses
 * elements past the limit, so the answer stays small for anything that count
 * can see.
 */
export class ComputedAccessibilityReader<T extends ComputedAccessibilityTab> {
  constructor(private readonly host: ComputedAccessibilityHost<T>) {}

  async read(tab: T, target: ComputedAccessibilityTarget, authority: ComputedAccessibilityAuthority): Promise<ComputedAccessibilityReport> {
    const selector = targetSelector(target)
    const contents = tab.webContents
    const origin = httpOrigin(tab.url)
    if (!origin || contents.isDestroyed()) throw new Error('Computed accessibility can be read only on an HTTP(S) page')
    const observationGeneration = tab.observationGeneration
    const current = (): void => {
      if (!this.host.isCurrent(tab) || tab.webContents !== contents || contents.isDestroyed()
        || tab.observationGeneration !== observationGeneration || httpOrigin(tab.url) !== origin) {
        throw new Error(PAGE_CHANGED)
      }
      authority.assertCurrent()
    }
    current()
    const blocked = this.host.conflict(tab)
    if (blocked) throw new Error(blocked)
    const projected = await this.host.withDebugger(tab, async () => {
      current()
      const inUse = this.host.conflict(tab)
      if (inUse) throw new Error(inUse)
      const keepDomEnabled = this.host.keepDomEnabled(tab)
      const send = <R>(method: string, params?: Record<string, unknown>): Promise<R> => contents.debugger.sendCommand(method, params) as Promise<R>
      const mainFrame = async (): Promise<{ id: string; loaderId: string }> => {
        const { frameTree } = await send<{ frameTree: { frame: { id: string; loaderId: string } } }>('Page.getFrameTree')
        return { id: frameTree.frame.id, loaderId: frameTree.frame.loaderId }
      }
      let resolved = false, askedChromium = false
      try {
        const main = await mainFrame()
        await send('DOM.enable')
        const document = await send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0, pierce: false })
        const find = async (first: boolean): Promise<number[]> => {
          try {
            return (await send<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector })).nodeIds
          } catch (error) {
            if (error instanceof RendererExitedError) throw error
            // A selector that worked once fails again only because the document it was found in is gone.
            throw new Error(first ? 'The selector is not valid CSS' : PAGE_CHANGED, { cause: error })
          }
        }
        const nodeIds = await find(true)
        if (nodeIds.length !== 1) {
          throw new Error(nodeIds.length ? 'The target matches more than one element; use a ref or a selector that identifies exactly one element'
            : 'No element in the top-level document matches the target; take a fresh snapshot or check the selector')
        }
        const nodeId = nodeIds[0]!
        const { node } = await send<{ node: { backendNodeId: number; nodeType: number } }>('DOM.describeNode', { nodeId, depth: 0, pierce: false })
        if (node.nodeType !== 1) throw new Error('The target is not an element')
        const world = await send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: main.id, worldName: WORLD_NAME, grantUniveralAccess: false })
        resolved = true
        const { object } = await send<{ object: { objectId?: string } }>('DOM.resolveNode', {
          backendNodeId: node.backendNodeId, executionContextId: world.executionContextId, objectGroup: OBJECT_GROUP
        })
        if (!object.objectId) throw new Error(PAGE_CHANGED)
        const bound = readBound(await send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: TEXT_BOUND_FUNCTION,
          arguments: [{ value: COMPUTED_ACCESSIBILITY_LIMITS.maxTextChars }, { value: COMPUTED_ACCESSIBILITY_LIMITS.maxElements }],
          returnByValue: true
        }))
        if (bound.chars > COMPUTED_ACCESSIBILITY_LIMITS.maxTextChars || bound.elements > COMPUTED_ACCESSIBILITY_LIMITS.maxElements) {
          throw new Error(TOO_MUCH_TEXT)
        }
        current()
        askedChromium = true
        const answer = await send<{ nodes?: unknown }>('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false })
        const axNode = Array.isArray(answer.nodes)
          ? answer.nodes.slice(0, MAX_LIST_ENTRIES).find((candidate: AxNode | null) => candidate?.backendDOMNodeId === node.backendNodeId) as AxNode | undefined
          : undefined
        if (!axNode) throw new Error('Chromium reported no accessibility node for the element')
        if (!withinBound(axNode, bound)) throw new Error(EXCEEDED_BOUND)
        const report = projectComputedAccessibility(axNode)
        // The same element of the same document, or nothing.
        const after = await find(false)
        if (after.length !== 1 || after[0] !== nodeId || (await mainFrame()).loaderId !== main.loaderId) throw new Error(PAGE_CHANGED)
        current()
        return report
      } finally {
        if (!contents.isDestroyed() && contents.debugger.isAttached()) {
          if (resolved) await contents.debugger.sendCommand('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => undefined)
          if (askedChromium) {
            // The read leaves the document's accessibility tree on, kept up to date on every change. Chromium 152
            // releases it only when disabling a domain it enabled, so it is enabled first; no events follow either.
            await contents.debugger.sendCommand('Accessibility.enable').catch(() => undefined)
            await contents.debugger.sendCommand('Accessibility.disable').catch(() => undefined)
          }
          if (!keepDomEnabled) await contents.debugger.sendCommand('DOM.disable').catch(() => undefined)
        }
      }
    })
    current()
    return {
      tabId: tab.id,
      source: 'chromium-accessibility-tree',
      chromium: process.versions.chrome ?? 'unknown',
      ...projected,
      caveats: [...COMPUTED_ACCESSIBILITY_CAVEATS]
    }
  }
}
