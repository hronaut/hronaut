import type { DESIGN_OVERVIEW_LIMITS } from './design-overview.js'
import type { BrowserDesignOverviewContrastIssue, BrowserDesignOverviewReport } from './types.js'

interface DesignColor {
  red: number
  green: number
  blue: number
  alpha: number
}

/**
 * Runs in the design overview's isolated world: counts the colors, type and media queries of a bounded sample of the
 * rendered elements, and checks the contrast of their direct text. It returns no CSS source, page text, field values,
 * element IDs, class names or markup.
 */
export function designOverviewInPage(limits: typeof DESIGN_OVERVIEW_LIMITS): Omit<BrowserDesignOverviewReport, 'tabId'> {
  const increment = (map: Map<string, number>, key: string) => {
    if (!key) return
    map.set(key, (map.get(key) || 0) + 1)
  }
  const bounded = (value: unknown, length: number): string => String(value || '').trim().slice(0, length)
  const normalizeColor = (value: unknown): string => {
    const color = bounded(value, 64).toLowerCase()
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return ''
    return color
  }
  const parseColor = (value: unknown): DesignColor | null => {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i)
    if (!match) return null
    const parts = match[1]!.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (part: string) => part.endsWith('%')
      ? Math.max(0, Math.min(255, Number.parseFloat(part) * 2.55))
      : Math.max(0, Math.min(255, Number.parseFloat(part)))
    const red = channel(parts[0]!)
    const green = channel(parts[1]!)
    const blue = channel(parts[2]!)
    const alpha = parts[3] == null ? 1 : Math.max(0, Math.min(1, Number.parseFloat(parts[3])))
    if (![red, green, blue, alpha].every(Number.isFinite)) return null
    return { red, green, blue, alpha }
  }
  const composite = (foreground: DesignColor, background: DesignColor): DesignColor => {
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
    if (alpha <= 0) return { red: 255, green: 255, blue: 255, alpha: 1 }
    return {
      red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
      green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
      blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
      alpha
    }
  }
  const luminance = (color: DesignColor): number => {
    const transform = (channel: number) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * transform(color.red) + 0.7152 * transform(color.green) + 0.0722 * transform(color.blue)
  }
  const contrast = (foreground: DesignColor, background: DesignColor): number => {
    const foregroundLuminance = luminance(foreground)
    const backgroundLuminance = luminance(background)
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  }
  const selectorFor = (element: Element): string => {
    const parts: string[] = []
    let current: Element | null = element
    while (current && current.nodeType === 1 && parts.length < 4) {
      const tag = current.tagName.toLowerCase()
      let index = 1
      let sibling = current.previousElementSibling
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1
        sibling = sibling.previousElementSibling
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')')
      current = current.parentElement
    }
    return bounded(parts.join(' > '), 240)
  }
  const effectiveBackground = (element: Element): DesignColor | null => {
    let current: Element | null = element
    let result: DesignColor = { red: 255, green: 255, blue: 255, alpha: 1 }
    const layers: DesignColor[] = []
    while (current) {
      const style = getComputedStyle(current)
      if (style.backgroundImage && style.backgroundImage !== 'none') return null
      const parsed = parseColor(style.backgroundColor)
      if (parsed && parsed.alpha > 0) layers.push(parsed)
      current = current.parentElement
    }
    for (let index = layers.length - 1; index >= 0; index -= 1) result = composite(layers[index]!, result)
    return result
  }
  const ranked = <T extends object>(map: Map<string, number>, limit: number, toValue: (key: string) => T) => Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ ...toValue(key), count }))

  const textColors = new Map<string, number>()
  const backgroundColors = new Map<string, number>()
  const borderColors = new Map<string, number>()
  const fonts = new Map<string, number>()
  const contrastIssues: BrowserDesignOverviewContrastIssue[] = []
  let contrastIssueCount = 0
  const elements = Array.from(document.querySelectorAll('*'))
  const scanned = elements.slice(0, limits.maxElements)
  let visibleElements = 0
  let textElements = 0

  for (const element of scanned) {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const visible = style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.visibility !== 'collapse'
      && Number.parseFloat(style.opacity || '1') > 0
      && rect.width > 0
      && rect.height > 0
    if (!visible) continue
    visibleElements += 1

    increment(textColors, normalizeColor(style.color))
    increment(backgroundColors, normalizeColor(style.backgroundColor))
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (Number.parseFloat((style as unknown as Record<string, string>)['border' + side + 'Width'] || '0') > 0) {
        increment(borderColors, normalizeColor((style as unknown as Record<string, string>)['border' + side + 'Color']))
      }
    }

    const fontFamily = bounded(style.fontFamily, 160)
    const fontSize = Number.parseFloat(style.fontSize)
    const lineHeight = bounded(style.lineHeight, 32)
    const fontWeight = bounded(style.fontWeight, 16)
    const fontKey = JSON.stringify([fontFamily, Number.isFinite(fontSize) ? Math.round(fontSize * 100) / 100 : null, fontWeight, lineHeight])
    increment(fonts, fontKey)

    const hasDirectText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && /\S/.test(node.nodeValue || ''))
    if (!hasDirectText) continue
    textElements += 1
    const foreground = parseColor(style.color)
    const background = effectiveBackground(element)
    if (!foreground || !background || foreground.alpha <= 0) continue
    const opaqueForeground = composite(foreground, background)
    const ratio = contrast(opaqueForeground, background)
    const weight = Number.parseInt(style.fontWeight, 10) || 400
    const largeText = Number.isFinite(fontSize) && (fontSize >= 24 || (fontSize >= 18.66 && weight >= 700))
    const requiredRatio = largeText ? 3 : 4.5
    if (ratio < requiredRatio) {
      contrastIssueCount += 1
      if (contrastIssues.length < limits.maxContrastIssues) {
        contrastIssues.push({
          selector: selectorFor(element),
          foreground: normalizeColor(style.color),
          background: normalizeColor(style.backgroundColor) || 'inherited',
          ratio: Math.round(ratio * 100) / 100,
          requiredRatio,
          fontSizePx: Number.isFinite(fontSize) ? Math.round(fontSize * 100) / 100 : null,
          fontWeight,
          largeText
        })
      }
    }
  }

  const mediaQueries = new Map<string, number>()
  let accessibleStyleSheets = 0
  let inaccessibleStyleSheets = 0
  let cssRuleCount = 0
  let cssRulesTruncated = false
  const visitRules = (rules: CSSRuleList | undefined): void => {
    for (const rule of Array.from(rules || [])) {
      if (cssRuleCount >= limits.maxCssRules) {
        cssRulesTruncated = true
        return
      }
      cssRuleCount += 1
      if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
        increment(mediaQueries, bounded(rule.conditionText, 160))
      }
      if ((rule as CSSGroupingRule).cssRules) visitRules((rule as CSSGroupingRule).cssRules)
      if (cssRulesTruncated) return
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visitRules(sheet.cssRules)
      accessibleStyleSheets += 1
    } catch {
      inaccessibleStyleSheets += 1
    }
    if (cssRulesTruncated) break
  }

  return {
    url: String(location.href).slice(0, 2048),
    title: String(document.title || '').slice(0, 512),
    capturedAt: new Date().toISOString(),
    summary: {
      elementCount: elements.length,
      elementsScanned: scanned.length,
      visibleElements,
      textElementsChecked: textElements,
      styleSheetCount: document.styleSheets.length,
      accessibleStyleSheets,
      inaccessibleStyleSheets,
      cssRuleCount,
      textColorCount: textColors.size,
      backgroundColorCount: backgroundColors.size,
      borderColorCount: borderColors.size,
      fontCombinationCount: fonts.size,
      contrastIssueCount,
      truncated: elements.length > limits.maxElements || cssRulesTruncated || contrastIssueCount > contrastIssues.length
    },
    colors: {
      text: ranked(textColors, limits.maxColors, (value) => ({ value })),
      background: ranked(backgroundColors, limits.maxColors, (value) => ({ value })),
      border: ranked(borderColors, limits.maxColors, (value) => ({ value }))
    },
    fonts: ranked(fonts, limits.maxFonts, (value) => {
      const parsed = JSON.parse(value) as [string, number | null, string, string]
      return { family: parsed[0], sizePx: parsed[1], weight: parsed[2], lineHeight: parsed[3] }
    }),
    mediaQueries: ranked(mediaQueries, limits.maxMediaQueries, (query) => ({ query })),
    contrastIssues,
    caveats: [
      'This is a bounded current-rendering sample, not a complete stylesheet inventory.',
      'Cross-origin stylesheets can contribute computed styles but their rules and media queries cannot be enumerated.',
      'Contrast checks skip gradients and complex imagery and may not model overlays, filters, pseudo-elements, or blended backgrounds.',
      'No CSS source, DOM text, form values, element IDs, class names, or page markup are returned.'
    ]
  }
}
