export const DESIGN_OVERVIEW_LIMITS = {
  maxElements: 2_500,
  maxColors: 24,
  maxFonts: 24,
  maxContrastIssues: 25,
  maxMediaQueries: 30,
  maxCssRules: 20_000
} as const

export function designOverviewPageScript(): string {
  return `(() => {
    const limits = ${JSON.stringify(DESIGN_OVERVIEW_LIMITS)};
    const increment = (map, key) => {
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    };
    const bounded = (value, length) => String(value || '').trim().slice(0, length);
    const normalizeColor = (value) => {
      const color = bounded(value, 64).toLowerCase();
      if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return '';
      return color;
    };
    const parseColor = (value) => {
      const match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);
      if (!match) return null;
      const parts = match[1].replace(/\\//g, ' ').split(/[\\s,]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const channel = (part) => part.endsWith('%')
        ? Math.max(0, Math.min(255, Number.parseFloat(part) * 2.55))
        : Math.max(0, Math.min(255, Number.parseFloat(part)));
      const red = channel(parts[0]);
      const green = channel(parts[1]);
      const blue = channel(parts[2]);
      const alpha = parts[3] == null ? 1 : Math.max(0, Math.min(1, Number.parseFloat(parts[3])));
      if (![red, green, blue, alpha].every(Number.isFinite)) return null;
      return { red, green, blue, alpha };
    };
    const composite = (foreground, background) => {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      if (alpha <= 0) return { red: 255, green: 255, blue: 255, alpha: 1 };
      return {
        red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
        green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
        blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
        alpha
      };
    };
    const luminance = (color) => {
      const transform = (channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * transform(color.red) + 0.7152 * transform(color.green) + 0.0722 * transform(color.blue);
    };
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    const selectorFor = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) index += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(tag + ':nth-of-type(' + index + ')');
        current = current.parentElement;
      }
      return bounded(parts.join(' > '), 240);
    };
    const effectiveBackground = (element) => {
      let current = element;
      let result = { red: 255, green: 255, blue: 255, alpha: 1 };
      const layers = [];
      while (current) {
        const style = getComputedStyle(current);
        if (style.backgroundImage && style.backgroundImage !== 'none') return null;
        const parsed = parseColor(style.backgroundColor);
        if (parsed && parsed.alpha > 0) layers.push(parsed);
        current = current.parentElement;
      }
      for (let index = layers.length - 1; index >= 0; index -= 1) result = composite(layers[index], result);
      return result;
    };
    const ranked = (map, limit, toValue = (key) => key) => Array.from(map.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([key, count]) => ({ ...toValue(key), count }));

    const textColors = new Map();
    const backgroundColors = new Map();
    const borderColors = new Map();
    const fonts = new Map();
    const contrastIssues = [];
    let contrastIssueCount = 0;
    const elements = Array.from(document.querySelectorAll('*'));
    const scanned = elements.slice(0, limits.maxElements);
    let visibleElements = 0;
    let textElements = 0;

    for (const element of scanned) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && Number.parseFloat(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
      if (!visible) continue;
      visibleElements += 1;

      increment(textColors, normalizeColor(style.color));
      increment(backgroundColors, normalizeColor(style.backgroundColor));
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (Number.parseFloat(style['border' + side + 'Width'] || '0') > 0) {
          increment(borderColors, normalizeColor(style['border' + side + 'Color']));
        }
      }

      const fontFamily = bounded(style.fontFamily, 160);
      const fontSize = Number.parseFloat(style.fontSize);
      const lineHeight = bounded(style.lineHeight, 32);
      const fontWeight = bounded(style.fontWeight, 16);
      const fontKey = JSON.stringify([fontFamily, Number.isFinite(fontSize) ? Math.round(fontSize * 100) / 100 : null, fontWeight, lineHeight]);
      increment(fonts, fontKey);

      const hasDirectText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && /\\S/.test(node.nodeValue || ''));
      if (!hasDirectText) continue;
      textElements += 1;
      const foreground = parseColor(style.color);
      const background = effectiveBackground(element);
      if (!foreground || !background || foreground.alpha <= 0) continue;
      const opaqueForeground = composite(foreground, background);
      const ratio = contrast(opaqueForeground, background);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const largeText = Number.isFinite(fontSize) && (fontSize >= 24 || (fontSize >= 18.66 && weight >= 700));
      const requiredRatio = largeText ? 3 : 4.5;
      if (ratio < requiredRatio) {
        contrastIssueCount += 1;
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
          });
        }
      }
    }

    const mediaQueries = new Map();
    let accessibleStyleSheets = 0;
    let inaccessibleStyleSheets = 0;
    let cssRuleCount = 0;
    let cssRulesTruncated = false;
    const visitRules = (rules) => {
      for (const rule of Array.from(rules || [])) {
        if (cssRuleCount >= limits.maxCssRules) {
          cssRulesTruncated = true;
          return;
        }
        cssRuleCount += 1;
        if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
          increment(mediaQueries, bounded(rule.conditionText, 160));
        }
        if (rule.cssRules) visitRules(rule.cssRules);
        if (cssRulesTruncated) return;
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visitRules(sheet.cssRules);
        accessibleStyleSheets += 1;
      } catch {
        inaccessibleStyleSheets += 1;
      }
      if (cssRulesTruncated) break;
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
        const parsed = JSON.parse(value);
        return { family: parsed[0], sizePx: parsed[1], weight: parsed[2], lineHeight: parsed[3] };
      }),
      mediaQueries: ranked(mediaQueries, limits.maxMediaQueries, (query) => ({ query })),
      contrastIssues,
      caveats: [
        'This is a bounded current-rendering sample, not a complete stylesheet inventory.',
        'Cross-origin stylesheets can contribute computed styles but their rules and media queries cannot be enumerated.',
        'Contrast checks skip gradients and complex imagery and may not model overlays, filters, pseudo-elements, or blended backgrounds.',
        'No CSS source, DOM text, form values, element IDs, class names, or page markup are returned.'
      ]
    };
  })()`
}
