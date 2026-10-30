import type { SIZING_INPUT_PROPERTIES } from '../../../shared/element-sizing-inputs.js'
import type { FORM_VALIDITY_FLAGS } from '../../../shared/form-validity.js'
import type { BrowserValueComparison } from '../../../shared/value-comparison.js'
import type { ElementScrollGeometryPage } from '../element-scroll-geometry.page.js'
import type { SizingInputsPageResult } from '../element-sizing-inputs.page.js'
import type { FormValidityPageResult } from '../form-validity.page.js'
import type { SnapshotText, SnapshotTextOptions } from '../snapshot-text.page.js'

/** An element as inspection names it: a snapshot ref or a CSS selector, with what else to read about it. */
export interface InspectionTarget {
  ref?: string
  selector?: string
  includeFonts?: boolean
  includeScroll?: boolean
  includePasswordOccupancy?: boolean
  includeValidity?: boolean
  includeSizingInputs?: boolean
  includeFlexContainer?: boolean
}

interface Edges { top: number; right: number; bottom: number; left: number }

/** One element's inspection as the page reports it; main checks and bounds it again. */
export interface ElementInspectionPage {
  selector: string
  tag: string
  text: string
  attributes: { name: string; value: string }[]
  box: {
    x: number
    y: number
    width: number
    height: number
    contentWidth: number
    contentHeight: number
    boxSizing: string
    margin: Edges
    border: Edges
    padding: Edges
  }
  layout: Record<string, string>
  typography: {
    color: string
    backgroundColor: string
    fontFamily: string
    fontSize: string
    fontWeight: string
    lineHeight: string
    letterSpacing: string
    textAlign: string
    whiteSpace: string
    contrastRatio: number | undefined
  }
  accessibility: { role: string; name: string; focusable: boolean; focused: boolean; focusWithin: boolean; disabled: boolean; checked?: boolean | 'mixed' }
}

/** The inspection helpers of one script, sharing one capture's text collection. */
export interface ElementInspectionTools {
  snapshotText: SnapshotText
  compact: (value: unknown, limit: number) => string
  selectorFor: (element: Element) => string
  role: (element: Element) => string
  accessibleName: (element: Element) => string
  inspectElement: (element: Element) => ElementInspectionPage
}

type CreateSnapshotText = (options: SnapshotTextOptions, maxChars: number) => SnapshotText
type CreateInspectionTools = (createSnapshotText: CreateSnapshotText) => ElementInspectionTools

/** What the element picker resolves with: the clicked element's inspection, or that the person canceled. */
export type ElementPickerPageResult = { canceled: true } | { canceled: false; inspection: ElementInspectionPage }

interface ElementPicker { cancel: () => void; nativeInput: (type: string, x: number, y: number) => boolean }

type ElementPickerPage = Window & typeof globalThis & {
  __hronautElementPicker?: ElementPicker
  __hronautScreenshotArea?: { cancel?: unknown }
  __hronautAgentInputActive?: boolean
}

/**
 * Runs in the page: the helpers element inspection shares between its scripts. Text comes from the snapshot's text
 * collection, which leaves editor content and form field values out.
 */
export function elementInspectionToolsInPage(createSnapshotText: CreateSnapshotText): ElementInspectionTools {
  const snapshotText = createSnapshotText({ excludeFormControls: true, textContentFallback: true }, 500)
  const compact = (value: unknown, limit: number): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const unique = (selector: string): boolean => {
    try { return document.querySelectorAll(selector).length === 1 } catch { return false }
  }
  const selectorFor = (element: Element): string => {
    if (element.id) {
      const selector = '#' + CSS.escape(element.id)
      if (unique(selector)) return selector
    }
    for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      const selector = '[' + attribute + '=' + JSON.stringify(value) + ']'
      if (unique(selector)) return selector
    }
    const parts: string[] = []
    let node: Element | null = element
    while (node instanceof Element && node !== document.documentElement && parts.length < 8) {
      let part = node.localName || 'element'
      const parent: Element | null = node.parentElement
      if (parent) {
        const siblings = [...parent.children].filter((candidate) => candidate.localName === node!.localName)
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      const selector = parts.join(' > ')
      if (unique(selector)) return selector
      node = parent
    }
    return parts.join(' > ')
  }
  const safeAttributes = (element: Element): { name: string; value: string }[] => {
    const names = ['id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-disabled', 'aria-checked', 'title', 'href', 'src', 'alt', 'placeholder', 'data-testid', 'data-test', 'data-cy']
    return names.flatMap((name) => {
      let value = element.getAttribute(name)
      if (!value) return []
      if (name === 'href' || name === 'src') {
        try {
          const url = new URL(value, location.href)
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            url.username = ''
            url.password = ''
            url.search = ''
            url.hash = ''
            value = url.href
          } else if (url.protocol !== 'data:') value = url.href
          else return []
        } catch { return [] }
      }
      return [{ name, value: compact(value, 300) }]
    })
  }
  const number = (value: string): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
  }
  const edges = (style: CSSStyleDeclaration, prefix: string, suffix = ''): Edges => {
    const read = style as unknown as Record<string, string>
    return {
      top: number(read[prefix + 'Top' + suffix]!),
      right: number(read[prefix + 'Right' + suffix]!),
      bottom: number(read[prefix + 'Bottom' + suffix]!),
      left: number(read[prefix + 'Left' + suffix]!)
    }
  }
  const role = (element: Element): string => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.localName
    if (tag === 'button') return 'button'
    if (tag === 'a' && element.hasAttribute('href')) return 'link'
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'input') {
      const type = String((element as HTMLInputElement).type || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (['button', 'submit', 'reset'].includes(type)) return 'button'
      return 'textbox'
    }
    return tag || 'element'
  }
  const accessibleName = (element: Element): string => {
    const labelledBy = element.getAttribute('aria-labelledby')
    const referenced = labelledBy
      ? labelledBy.split(/\s+/).map((id) => snapshotText.safeText(document.getElementById(id))).join(' ')
      : ''
    const fieldLabels = 'labels' in element ? (element as HTMLInputElement).labels : null
    const labels = fieldLabels
      ? [...fieldLabels].map((label) => snapshotText.safeText(label)).join(' ')
      : ''
    const formControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    return compact(
      element.getAttribute('aria-label')
        || referenced
        || labels
        || element.getAttribute('alt')
        || element.getAttribute('title')
        || element.getAttribute('placeholder')
        || (formControl ? '' : snapshotText.safeText(element)),
      500
    )
  }
  const rgb = (value: string): { r: number; g: number; b: number; a: number } | null => {
    const match = String(value).match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i)
    if (!match) return null
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
  }
  const luminance = (color: { r: number; g: number; b: number }): number => {
    const channel = (value: number): number => {
      const normalized = value / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  }
  const contrast = (foreground: string, background: string): number | undefined => {
    const front = rgb(foreground)
    const back = rgb(background)
    if (!front || !back || front.a !== 1 || back.a !== 1) return undefined
    const first = luminance(front)
    const second = luminance(back)
    return Math.round(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)) * 100) / 100
  }
  const inspectElement = (element: Element): ElementInspectionPage => {
    snapshotText.reset()
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const padding = edges(style, 'padding')
    const border = edges(style, 'border', 'Width')
    const formControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    const text = compact(formControl
      ? (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '')
      : snapshotText.safeText(element), 500)
    const ariaChecked = element.getAttribute('aria-checked')
    const nativeChecked = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
      ? element.checked
      : undefined
    const checked = nativeChecked !== undefined
      ? nativeChecked
      : ariaChecked === 'mixed' ? 'mixed' : ariaChecked === 'true' ? true : ariaChecked === 'false' ? false : undefined
    const focusable = !element.matches(':disabled') && (
      element.matches('a[href],button,input,select,textarea,summary,[contenteditable="true"]')
      || (element as HTMLElement).tabIndex >= 0
    )
    const isFlex = style.display.includes('flex')
    const isGrid = style.display.includes('grid')
    return {
      selector: selectorFor(element),
      tag: element.localName || element.tagName.toLowerCase(),
      text,
      attributes: safeAttributes(element),
      box: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        contentWidth: Math.max(0, rect.width - padding.left - padding.right - border.left - border.right),
        contentHeight: Math.max(0, rect.height - padding.top - padding.bottom - border.top - border.bottom),
        boxSizing: style.boxSizing,
        margin: edges(style, 'margin'),
        border,
        padding
      },
      layout: {
        display: style.display,
        position: style.position,
        zIndex: style.zIndex,
        visibility: style.visibility,
        opacity: style.opacity,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        ...(isFlex ? { flexDirection: style.flexDirection, alignItems: style.alignItems, justifyContent: style.justifyContent } : {}),
        ...(isGrid ? { gridTemplateColumns: style.gridTemplateColumns, gridTemplateRows: style.gridTemplateRows, alignItems: style.alignItems, justifyContent: style.justifyContent } : {})
      },
      typography: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
        whiteSpace: style.whiteSpace,
        contrastRatio: contrast(style.color, style.backgroundColor)
      },
      accessibility: {
        role: role(element),
        name: accessibleName(element),
        focusable,
        focused: element.matches(':focus'),
        focusWithin: element.matches(':focus-within'),
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
        ...(checked !== undefined ? { checked } : {})
      }
    }
  }
  return { snapshotText, compact, selectorFor, role, accessibleName, inspectElement }
}

/**
 * Runs in the page: the element picker the person uses to choose an element. It outlines the element under the
 * pointer with its box model and a label, and resolves with the clicked element's inspection, or canceled on Escape,
 * on a new picker or on the screenshot area picker. Native input from main moves and clicks it the same way.
 */
export function elementPickerInPage(createTools: CreateInspectionTools, createSnapshotText: CreateSnapshotText): Promise<ElementPickerPageResult> {
  return new Promise((resolve) => {
    const page = window as ElementPickerPage
    const areaPicker = page.__hronautScreenshotArea
    if (areaPicker && typeof areaPicker.cancel === 'function') areaPicker.cancel()
    const previous = page.__hronautElementPicker
    if (previous && typeof previous.cancel === 'function') previous.cancel()

    const makeLayer = (name: string, background: string): HTMLDivElement => {
      const layer = document.createElement('div')
      layer.setAttribute('data-hronaut-element-picker', name)
      Object.assign(layer.style, {
        position: 'fixed',
        zIndex: '2147483646',
        pointerEvents: 'none',
        background,
        display: 'none'
      })
      return layer
    }
    const marginLayer = makeLayer('margin', 'rgba(246, 178, 107, 0.34)')
    const overlay = makeLayer('overlay', 'rgba(255, 229, 153, 0.42)')
    const paddingLayer = makeLayer('padding', 'rgba(147, 196, 125, 0.42)')
    const contentLayer = makeLayer('content', 'rgba(111, 168, 220, 0.42)')
    Object.assign(overlay.style, {
      position: 'fixed',
      outline: '2px solid #6757e8',
      outlineOffset: '-1px',
      boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.86)'
    })
    const label = document.createElement('div')
    label.setAttribute('data-hronaut-element-picker', 'label')
    Object.assign(label.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      maxWidth: 'min(520px, calc(100vw - 16px))',
      padding: '5px 8px',
      borderRadius: '5px',
      color: '#fff',
      background: '#5747d6',
      boxShadow: '0 3px 12px rgba(0, 0, 0, 0.28)',
      font: '600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      whiteSpace: 'pre-line',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: 'none'
    })
    document.documentElement.append(marginLayer, overlay, paddingLayer, contentLayer, label)

    const tools = createTools(createSnapshotText)

    let current: Element | null = null
    let nativeDown: Element | null = null
    let finished = false
    const positionLayer = (layer: HTMLElement, x: number, y: number, width: number, height: number): void => {
      layer.style.display = width > 0 && height > 0 ? 'block' : 'none'
      layer.style.left = x + 'px'
      layer.style.top = y + 'px'
      layer.style.width = Math.max(0, width) + 'px'
      layer.style.height = Math.max(0, height) + 'px'
    }
    const edgeSummary = (edges: Edges): string => [edges.top, edges.right, edges.bottom, edges.left].join('/')
    const position = (element: Element): void => {
      const inspection = tools.inspectElement(element)
      const rect = inspection.box
      const margin = rect.margin
      const border = rect.border
      const padding = rect.padding
      positionLayer(marginLayer, rect.x - margin.left, rect.y - margin.top, rect.width + margin.left + margin.right, rect.height + margin.top + margin.bottom)
      positionLayer(overlay, rect.x, rect.y, rect.width, rect.height)
      positionLayer(paddingLayer, rect.x + border.left, rect.y + border.top, rect.width - border.left - border.right, rect.height - border.top - border.bottom)
      positionLayer(contentLayer, rect.x + border.left + padding.left, rect.y + border.top + padding.top, rect.contentWidth, rect.contentHeight)
      label.style.display = 'block'
      const contrast = inspection.typography.contrastRatio === undefined ? '' : ' · contrast ' + inspection.typography.contrastRatio + ':1'
      const layout = inspection.layout.display!.includes('flex') ? ' · flex' : inspection.layout.display!.includes('grid') ? ' · grid' : ''
      const accessibleName = inspection.accessibility.name ? ' ' + JSON.stringify(inspection.accessibility.name) : ''
      label.textContent = [
        inspection.selector + ' · ' + Math.round(rect.width) + ' × ' + Math.round(rect.height) + ' px' + layout,
        'content ' + rect.contentWidth + ' × ' + rect.contentHeight + ' · padding ' + edgeSummary(padding) + ' · margin ' + edgeSummary(margin),
        inspection.accessibility.role + accessibleName + ' · ' + (inspection.accessibility.focusable ? 'keyboard focusable' : 'not keyboard focusable') + contrast,
        'Click to copy · Esc to cancel'
      ].join('\n')
      const labelTop = rect.y >= 92 ? rect.y - 88 : Math.min(innerHeight - 84, rect.y + rect.height + 5)
      label.style.left = Math.max(8, Math.min(innerWidth - 520, rect.x)) + 'px'
      label.style.top = Math.max(4, labelTop) + 'px'
    }
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange, true)
      marginLayer.remove()
      overlay.remove()
      paddingLayer.remove()
      contentLayer.remove()
      label.remove()
      if (page.__hronautElementPicker?.cancel === cancel) delete page.__hronautElementPicker
    }
    const finish = (result: ElementPickerPageResult): void => {
      if (finished) return
      finished = true
      cleanup()
      resolve(result)
    }
    const cancel = (): void => finish({ canceled: true })
    const onPointerMove = (event: PointerEvent): void => {
      if (page.__hronautAgentInputActive === true) return
      const candidate = event.composedPath().find((node) => node instanceof Element && !node.hasAttribute?.('data-hronaut-element-picker'))
      if (!(candidate instanceof Element)) return
      current = candidate
      position(candidate)
    }
    const onClick = (event: MouseEvent): void => {
      if (page.__hronautAgentInputActive === true || event.isTrusted === false) return
      const candidate = event.composedPath().find((node) => node instanceof Element && !node.hasAttribute?.('data-hronaut-element-picker'))
      if (!(candidate instanceof Element)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      finish({ canceled: false, inspection: tools.inspectElement(candidate) })
    }
    const nativeInput = (type: string, x: number, y: number): boolean => {
      if (finished || !Number.isFinite(x) || !Number.isFinite(y)) return false
      const candidate = document.elementFromPoint(
        Math.max(0, Math.min(innerWidth - 1, x)),
        Math.max(0, Math.min(innerHeight - 1, y))
      )
      if (!(candidate instanceof Element) || candidate.hasAttribute('data-hronaut-element-picker')) return false
      current = candidate
      position(candidate)
      if (type === 'down') {
        nativeDown = candidate
        return true
      }
      if (type !== 'up') return true
      const pressed: Element | null = nativeDown
      nativeDown = null
      if (!(pressed instanceof Element)) return false
      if (pressed !== candidate && !pressed.contains(candidate) && !candidate.contains(pressed)) return false
      finish({ canceled: false, inspection: tools.inspectElement(candidate) })
      return true
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    const onViewportChange = (): void => { if (current?.isConnected) position(current) }
    page.__hronautElementPicker = { cancel, nativeInput }
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange, true)
  })
}

/** Runs in the page: cancels the open element picker; false when there is none. */
export function cancelElementPickerInPage(): boolean {
  const picker = (window as ElementPickerPage).__hronautElementPicker
  if (!picker || typeof picker.cancel !== 'function') return false
  picker.cancel()
  return true
}

/** Runs in the page: hands native input from main to the open element picker, scaled from main's viewport to the page's. */
export function elementPickerNativeInputInPage(type: 'down' | 'move' | 'up', x: number, y: number, viewportWidth: number, viewportHeight: number): boolean {
  const picker = (window as ElementPickerPage).__hronautElementPicker
  if (!picker || typeof picker.nativeInput !== 'function') return false
  const width = Math.max(1, viewportWidth)
  const height = Math.max(1, viewportHeight)
  return picker.nativeInput(
    type,
    x * innerWidth / width,
    y * innerHeight / height
  )
}

/** Runs in the page: the inspection of the element at a point of main's viewport, scaled to the page's. */
export function elementPickerInspectionAtPointInPage(
  point: { x: number; y: number; viewportWidth: number; viewportHeight: number },
  createTools: CreateInspectionTools,
  createSnapshotText: CreateSnapshotText
): ElementInspectionPage {
  const tools = createTools(createSnapshotText)
  const width = Math.max(1, point.viewportWidth)
  const height = Math.max(1, point.viewportHeight)
  const candidate = document.elementFromPoint(
    Math.max(0, Math.min(innerWidth - 1, point.x * innerWidth / width)),
    Math.max(0, Math.min(innerHeight - 1, point.y * innerHeight / height))
  )
  if (!(candidate instanceof Element) || candidate.hasAttribute('data-hronaut-element-picker')) {
    throw new Error('No selectable element was found at the pointer position.')
  }
  return tools.inspectElement(candidate)
}

/** What one inspection reads beyond the element itself, as the page gets it. */
export interface ElementInspectionPageConfig {
  target: InspectionTarget
  /** The internal handle that settlement and cleanup of the extra reads address. */
  token: string
  /** Sizing inputs or the flex container: the element must then be the one light-DOM match of a bounded selector. */
  sizing: boolean
  sizingProperties: typeof SIZING_INPUT_PROPERTIES
  validityFlags: typeof FORM_VALIDITY_FLAGS
  /** The text to compare the field's value with, or null when no comparison was asked for. */
  expected: string | null
  maxComparedLength: number
}

/** The inspection as the page reports it, with the extra reads that were asked for. */
export type ElementInspectionPageResult = ElementInspectionPage & Partial<SizingInputsPageResult> & {
  passwordOccupancy?: 'empty' | 'nonempty' | 'unknown'
  formValidity?: FormValidityPageResult
  valueComparison?: BrowserValueComparison
  scrollGeometry?: ElementScrollGeometryPage
  renderedFontsEligible?: boolean
}

/**
 * Runs in element inspection's isolated world: the inspection of the element the target names, and each extra read
 * the target asks for. Each extra read is its own page function, passed in.
 */
export function elementInspectionInPage(
  config: ElementInspectionPageConfig,
  createTools: CreateInspectionTools,
  createSnapshotText: CreateSnapshotText,
  sizingLookup: (target: InspectionTarget) => NodeListOf<Element>,
  sizingInputs: (element: Element, target: InspectionTarget, token: string, properties: typeof SIZING_INPUT_PROPERTIES, includeFlexContainer: boolean,
    sizingLookup: (target: InspectionTarget) => NodeListOf<Element>, parse: (property: string, value: unknown) => string | number | null,
    flexContainerContext: (element: Element) => unknown) => SizingInputsPageResult,
  parseSizingInput: (property: string, value: unknown) => string | number | null,
  flexContainerContext: (element: Element) => unknown,
  passwordOccupancy: (element: Element, target: InspectionTarget, token: string) => 'empty' | 'nonempty' | 'unknown',
  formValidity: (element: Element, target: InspectionTarget, token: string, flags: typeof FORM_VALIDITY_FLAGS) => FormValidityPageResult,
  valueComparison: (element: Element, target: InspectionTarget, token: string, expected: string, maxLength: number) => BrowserValueComparison,
  scrollGeometry: (element: Element) => ElementScrollGeometryPage
): ElementInspectionPageResult {
  const tools = createTools(createSnapshotText)
  const { target, token } = config
  const element = config.sizing ? sizingLookup(target)[0] : target.ref
    ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
    : target.selector ? document.querySelector(target.selector) : null
  if (!(element instanceof Element)) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  return {
    ...tools.inspectElement(element),
    ...(config.sizing ? sizingInputs(element, target, token, config.sizingProperties, target.includeFlexContainer === true, sizingLookup, parseSizingInput, flexContainerContext) : {}),
    ...(target.includePasswordOccupancy === true ? { passwordOccupancy: passwordOccupancy(element, target, token) } : {}),
    ...(target.includeValidity === true ? { formValidity: formValidity(element, target, token, config.validityFlags) } : {}),
    ...(config.expected !== null ? { valueComparison: valueComparison(element, target, token, config.expected, config.maxComparedLength) } : {}),
    ...(target.includeScroll === true ? { scrollGeometry: scrollGeometry(element) } : {}),
    ...(target.includeFonts === true ? {
      renderedFontsEligible: element instanceof HTMLElement
        && element.children.length === 0 && !element.shadowRoot
        && !element.matches('input,textarea,select,option,optgroup,iframe,frame,object,embed')
        && !tools.snapshotText.editingContext(element)
    } : {})
  }
}

/** A Playwright locator strategy that matches the element alone. */
export type LocatorCandidate = { strategy: string; role?: string; value: string }

/**
 * Runs in the page: a unique bounded CSS selector for the element the target names, and the Playwright locator
 * strategies (role, label, test id, placeholder, alt text, title) that match it alone in the light DOM.
 */
export function playwrightLocatorInPage(
  target: InspectionTarget,
  createTools: CreateInspectionTools,
  createSnapshotText: CreateSnapshotText
): { selector: string; candidates: LocatorCandidate[] } {
  const tools = createTools(createSnapshotText)
  const element = target.ref
    ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
    : target.selector ? document.querySelector(target.selector) : null
  if (!(element instanceof Element)) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
  // A depth-limited structural path may still be ambiguous. Reuse the
  // supplied target only after checking the exact selected element again.
  const requestedSelector = target.ref
    ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector
  const selector = [tools.selectorFor(element), requestedSelector].find(value => {
    // eslint-disable-next-line no-control-regex
    if (typeof value !== 'string' || !value || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value)) return false
    try {
      const matches = document.querySelectorAll(value)
      return matches.length === 1 && matches[0] === element
    } catch { return false }
  })
  if (!selector) throw new Error('The selected element did not produce a unique bounded selector. Take a fresh snapshot or provide a more specific CSS selector.')
  // The inspected target and uniqueness checks use the light DOM, while
  // Playwright's semantic locators also traverse open shadow roots. Do not
  // claim semantic uniqueness across roots we have not inspected.
  if ([...document.querySelectorAll('*')].some(candidate => candidate.shadowRoot)) {
    return { selector, candidates: [] }
  }
  const candidates: LocatorCandidate[] = []
  const uniqueElements = (predicate: (candidate: Element) => boolean): boolean => [...document.querySelectorAll('*')].filter(predicate).length === 1
  const role = tools.role(element)
  const name = tools.accessibleName(element)
  const playwrightRoles = new Set(['alert', 'button', 'checkbox', 'combobox', 'dialog', 'heading', 'img', 'link', 'listbox', 'menuitem', 'option', 'progressbar', 'radio', 'row', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem'])
  if (name && playwrightRoles.has(role) && uniqueElements((candidate) => tools.role(candidate) === role && tools.accessibleName(candidate) === name)) {
    candidates.push({ strategy: 'role', role, value: name })
  }
  const fieldLabels = 'labels' in element ? (element as HTMLInputElement).labels : null
  const labels = fieldLabels
    ? [...fieldLabels].map((label) => tools.compact(tools.snapshotText.safeText(label), 500)).filter(Boolean)
    : []
  for (const label of labels) {
    if (uniqueElements((candidate) => {
      const candidateLabels = 'labels' in candidate ? (candidate as HTMLInputElement).labels : null
      return Boolean(candidateLabels) && [...candidateLabels!].some((item) => tools.compact(tools.snapshotText.safeText(item), 500) === label)
    })) {
      candidates.push({ strategy: 'label', value: label })
      break
    }
  }
  const testId = element.getAttribute('data-testid')
  const boundedTestId = tools.compact(testId, 500)
  if (testId && testId === boundedTestId && uniqueElements((candidate) => candidate.getAttribute('data-testid') === testId)) {
    candidates.push({ strategy: 'test-id', value: testId })
  }
  const attributes = [
    ['placeholder', 'placeholder'],
    ['alt', 'alt-text'],
    ['title', 'title']
  ] as const
  for (const [attribute, strategy] of attributes) {
    const value = element.getAttribute(attribute)
    const boundedValue = tools.compact(value, 500)
    if (value && value === boundedValue && uniqueElements((candidate) => candidate.getAttribute(attribute) === value)) {
      candidates.push({ strategy, value })
    }
  }
  // Filtered names need not equal Playwright's actual accessible name.
  // Keep non-text strategies, or let the caller use the unique CSS fallback.
  const safeCandidates = tools.snapshotText.excluded() || tools.snapshotText.limited()
    ? candidates.filter(candidate => candidate.strategy !== 'role' && candidate.strategy !== 'label')
    : candidates
  return { selector, candidates: safeCandidates }
}
