import { redactDiagnosticText } from './debug-report.js'
import { redactNetworkUrl } from './network-details.js'
import type {
  BrowserElementBoxEdges,
  BrowserElementInspection
} from './types.js'

const ALLOWED_ATTRIBUTES = new Set([
  'id',
  'class',
  'name',
  'type',
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-disabled',
  'aria-checked',
  'title',
  'href',
  'src',
  'alt',
  'placeholder',
  'data-testid',
  'data-test',
  'data-cy'
])

const ZERO_EDGES: BrowserElementBoxEdges = { top: 0, right: 0, bottom: 0, left: 0 }

interface NormalizeElementInspectionInput {
  tabId: string
  title: string
  url: string
  raw: unknown
  capturedAt?: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, limit: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return redactDiagnosticText(value).replace(/\s+/g, ' ').trim().slice(0, limit)
}

function cssText(value: unknown, limit = 300, fallback = ''): string {
  return text(value, limit, fallback)
}

function finite(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(Math.max(value, -1_000_000), 1_000_000) * 100) / 100
}

function edges(value: unknown): BrowserElementBoxEdges {
  const source = record(value)
  return {
    top: finite(source.top),
    right: finite(source.right),
    bottom: finite(source.bottom),
    left: finite(source.left)
  }
}

function optionalCss(source: Record<string, unknown>, key: string, limit = 300): string | undefined {
  const value = cssText(source[key], limit)
  return value ? value : undefined
}

function normalizeAttributes(value: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(value)) return []
  const attributes: Array<{ name: string; value: string }> = []
  for (const item of value.slice(0, 24)) {
    const candidate = record(item)
    const name = text(candidate.name, 64).toLowerCase()
    if (!ALLOWED_ATTRIBUTES.has(name)) continue
    let attributeValue = text(candidate.value, 300)
    if ((name === 'href' || name === 'src') && /^https?:\/\//i.test(attributeValue)) {
      attributeValue = redactNetworkUrl(attributeValue)
    }
    if (attributeValue) attributes.push({ name, value: attributeValue })
  }
  return attributes
}

export function normalizeElementInspection(input: NormalizeElementInspectionInput): BrowserElementInspection {
  const raw = record(input.raw)
  const rawBox = record(raw.box)
  const rawLayout = record(raw.layout)
  const rawTypography = record(raw.typography)
  const rawAccessibility = record(raw.accessibility)
  const width = Math.max(0, finite(rawBox.width))
  const height = Math.max(0, finite(rawBox.height))
  const padding = edges(rawBox.padding)
  const border = edges(rawBox.border)
  const contentWidth = Math.max(0, finite(
    rawBox.contentWidth,
    width - padding.left - padding.right - border.left - border.right
  ))
  const contentHeight = Math.max(0, finite(
    rawBox.contentHeight,
    height - padding.top - padding.bottom - border.top - border.bottom
  ))
  const contrastRatio = typeof rawTypography.contrastRatio === 'number'
    && Number.isFinite(rawTypography.contrastRatio)
    && rawTypography.contrastRatio >= 1
    && rawTypography.contrastRatio <= 21
    ? Math.round(rawTypography.contrastRatio * 100) / 100
    : undefined
  const checked = rawAccessibility.checked === true || rawAccessibility.checked === false || rawAccessibility.checked === 'mixed'
    ? rawAccessibility.checked
    : undefined

  const selector = text(raw.selector, 500)
  const tag = text(raw.tag, 64, 'element').toLowerCase()
  if (!selector) throw new Error('The selected element did not produce a usable selector')

  return {
    tabId: input.tabId,
    title: text(input.title, 200),
    url: redactNetworkUrl(input.url),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    selector,
    tag,
    ...(text(raw.text, 500) ? { text: text(raw.text, 500) } : {}),
    attributes: normalizeAttributes(raw.attributes),
    box: {
      x: finite(rawBox.x),
      y: finite(rawBox.y),
      width,
      height,
      contentWidth,
      contentHeight,
      boxSizing: cssText(rawBox.boxSizing, 64, 'content-box'),
      margin: rawBox.margin ? edges(rawBox.margin) : { ...ZERO_EDGES },
      border,
      padding
    },
    layout: {
      display: cssText(rawLayout.display, 100, 'unknown'),
      position: cssText(rawLayout.position, 100, 'static'),
      zIndex: cssText(rawLayout.zIndex, 100, 'auto'),
      visibility: cssText(rawLayout.visibility, 100, 'visible'),
      opacity: cssText(rawLayout.opacity, 100, '1'),
      overflowX: cssText(rawLayout.overflowX, 100, 'visible'),
      overflowY: cssText(rawLayout.overflowY, 100, 'visible'),
      ...(optionalCss(rawLayout, 'flexDirection') ? { flexDirection: optionalCss(rawLayout, 'flexDirection') } : {}),
      ...(optionalCss(rawLayout, 'alignItems') ? { alignItems: optionalCss(rawLayout, 'alignItems') } : {}),
      ...(optionalCss(rawLayout, 'justifyContent') ? { justifyContent: optionalCss(rawLayout, 'justifyContent') } : {}),
      ...(optionalCss(rawLayout, 'gridTemplateColumns', 500) ? { gridTemplateColumns: optionalCss(rawLayout, 'gridTemplateColumns', 500) } : {}),
      ...(optionalCss(rawLayout, 'gridTemplateRows', 500) ? { gridTemplateRows: optionalCss(rawLayout, 'gridTemplateRows', 500) } : {})
    },
    typography: {
      color: cssText(rawTypography.color, 100, 'unknown'),
      backgroundColor: cssText(rawTypography.backgroundColor, 100, 'unknown'),
      fontFamily: cssText(rawTypography.fontFamily, 300, 'unknown'),
      fontSize: cssText(rawTypography.fontSize, 100, 'unknown'),
      fontWeight: cssText(rawTypography.fontWeight, 100, 'unknown'),
      lineHeight: cssText(rawTypography.lineHeight, 100, 'normal'),
      letterSpacing: cssText(rawTypography.letterSpacing, 100, 'normal'),
      textAlign: cssText(rawTypography.textAlign, 100, 'start'),
      whiteSpace: cssText(rawTypography.whiteSpace, 100, 'normal'),
      ...(contrastRatio !== undefined ? { contrastRatio } : {})
    },
    accessibility: {
      role: text(rawAccessibility.role, 100, tag),
      name: text(rawAccessibility.name, 500),
      focusable: rawAccessibility.focusable === true,
      disabled: rawAccessibility.disabled === true,
      ...(checked !== undefined ? { checked } : {})
    },
    caveats: [
      'Values are a bounded snapshot of computed rendering for the selected element, not stylesheet source or cascade history.',
      'Form values, inline event handlers, arbitrary DOM properties, and page markup are excluded.',
      'Selectors, safe attributes, visible text, and accessible names are page-authored and may still contain private data.',
      'Contrast is reported only when both computed text and background colors are opaque RGB values; layered or inherited backgrounds can make it incomplete.'
    ]
  }
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character)
}

function edgeSummary(value: BrowserElementBoxEdges): string {
  return `${value.top}/${value.right}/${value.bottom}/${value.left}px`
}

export function formatElementInspectionForAgent(report: BrowserElementInspection): string {
  const attributes = report.attributes.map(({ name, value }) => `${name}="${htmlEscape(value)}"`).join(' ')
  const voidElement = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(report.tag)
  const element = `<${report.tag}${attributes ? ` ${attributes}` : ''}>${voidElement ? '' : `${report.text ? htmlEscape(report.text) : ''}</${report.tag}>`}`
  return [
    'Selected DOM element',
    `Page: ${report.title} (${report.url})`,
    `Selector: ${report.selector}`,
    `Element: ${element}`,
    report.text ? `Text: ${JSON.stringify(report.text)}` : '',
    `Bounds: x=${Math.round(report.box.x)}, y=${Math.round(report.box.y)}, width=${Math.round(report.box.width)}, height=${Math.round(report.box.height)}`,
    `Box model: content=${report.box.contentWidth}×${report.box.contentHeight}px; padding=${edgeSummary(report.box.padding)}; border=${edgeSummary(report.box.border)}; margin=${edgeSummary(report.box.margin)}; box-sizing=${report.box.boxSizing}`,
    `Layout: display=${report.layout.display}; position=${report.layout.position}; z-index=${report.layout.zIndex}; overflow=${report.layout.overflowX}/${report.layout.overflowY}`,
    `Typography: color=${report.typography.color}; background=${report.typography.backgroundColor}; font=${report.typography.fontWeight} ${report.typography.fontSize}/${report.typography.lineHeight} ${report.typography.fontFamily}; align=${report.typography.textAlign}`,
    `Accessibility: role=${report.accessibility.role}; name=${JSON.stringify(report.accessibility.name)}; focusable=${report.accessibility.focusable}; disabled=${report.accessibility.disabled}${report.accessibility.checked !== undefined ? `; checked=${report.accessibility.checked}` : ''}`,
    report.typography.contrastRatio !== undefined ? `Contrast: ${report.typography.contrastRatio}:1 (solid computed colors only)` : '',
    'Privacy: form values, event handlers, page markup, and stylesheet source are excluded; review page-authored text before sharing.'
  ].filter(Boolean).join('\n')
}
