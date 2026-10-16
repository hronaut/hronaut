import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RESOLVED_THEME_NAMES } from '../src/shared/theme.js'

const rendererRoot = fileURLToPath(new URL('../src/renderer/src/', import.meta.url))
const tokens = readFileSync(join(rendererRoot, 'styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

function stylesheets(directory = rendererRoot): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return stylesheets(path)
    return /\.(css|vue)$/u.test(name) && name !== 'tokens.css' ? [path] : []
  })
}

/** Declarations that apply to one theme's root, in cascade order. */
function themeTokens(theme: string): Map<string, string> {
  const values = new Map<string, string>()
  // Media-query overrides, such as reduced motion, are not the theme's own values.
  const unconditional = tokens.replace(/@media[^{]+\{[\s\S]*?\n\}/gu, '')
  for (const [, selector, body] of unconditional.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selectors = selector!.split(',').map((entry) => entry.trim())
    if (!selectors.includes(':root') && !selectors.includes(`:root[data-theme="${theme}"]`)) continue
    for (const [, name, value] of body!.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) values.set(name!, value!.trim())
  }
  return values
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

/** `top` at `alpha` over an opaque `bottom`, as color-mix with transparent composites. */
function mix(top: string, bottom: string, alpha: number): string {
  const channels = [1, 3, 5].map((index) => Math.round(
    Number.parseInt(top.slice(index, index + 2), 16) * alpha + Number.parseInt(bottom.slice(index, index + 2), 16) * (1 - alpha)
  ))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter! + 0.05) / (darker! + 0.05)
}

describe('design tokens v2', () => {
  it('defines one type scale, corner set, elevation set and motion set for every theme', () => {
    const shared = themeTokens('light')
    expect(['micro', 'small', 'body', 'title', 'heading', 'display'].map((step) => [
      shared.get(`--type-${step}-size`), shared.get(`--type-${step}-line`), shared.get(`--type-${step}-weight`)
    ])).toEqual([
      ['11px', '16px', '500'], ['12px', '18px', '400'], ['13px', '20px', '400'],
      ['15px', '22px', '600'], ['20px', '26px', '600'], ['28px', '32px', '600']
    ])
    expect(shared.get('--type-heading-tracking')).toBe('-0.015em')
    expect(shared.get('--type-display-tracking')).toBe('-0.025em')
    expect([1, 2, 3, 4].map((step) => shared.get(`--corner-${step}`))).toEqual(['6px', '9px', '12px', '16px'])
    expect(['instant', 'fast', 'base', 'slow'].map((step) => shared.get(`--motion-${step}`))).toEqual(['90ms', '140ms', '200ms', '320ms'])
    expect(shared.get('--motion-ease-out')).toBe('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(shared.get('--motion-ease-spring')).toBe('cubic-bezier(0.34, 1.36, 0.64, 1)')
    for (const level of [1, 2, 3]) expect(shared.get(`--elevation-${level}`)).toMatch(/^inset 0 1px 0 var\(--elevation-highlight\), /u)
  })

  it('turns movement into fades from one reduced-motion override', () => {
    const reduced = tokens.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u)?.[1] ?? ''
    expect(reduced).toContain('--motion-enter-y: 0px;')
    expect(reduced).toContain('--motion-enter-scale: 1;')
    expect(reduced).toContain('--motion-ease-spring: var(--motion-ease-out);')
  })

  it('keeps the amber needs-you color readable as text on every theme surface and on its own soft fill', () => {
    expect(themeTokens('light').get('--needs-you-soft')).toBe('color-mix(in srgb, var(--needs-you) 14%, transparent)')
    for (const theme of RESOLVED_THEME_NAMES) {
      const values = themeTokens(theme)
      const amber = values.get('--needs-you')
      expect(amber, theme).toMatch(/^#[0-9a-f]{6}$/u)
      for (const surface of ['--surface', '--surface-raised', '--surface-muted', '--toolbar', '--shell-top', '--hover']) {
        const background = values.get(surface)
        expect(background, `${theme} ${surface}`).toMatch(/^#[0-9a-f]{6}$/u)
        expect(contrast(amber!, background!), `${theme} ${surface}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(amber!, mix(amber!, background!, 0.14)), `${theme} soft fill on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(values.get('--connected')).toBe('var(--success)')
    }
  })

  it('keeps elevation shadows neutral in every theme', () => {
    for (const theme of RESOLVED_THEME_NAMES) {
      const values = themeTokens(theme)
      for (const level of [1, 2, 3]) {
        const elevation = values.get(`--elevation-${level}`) ?? ''
        // A theme's tinted --shadow would turn dialog shadows pink, green or red.
        expect(elevation, `${theme} ${level}`).not.toContain('var(--shadow)')
        expect(elevation.replace(/^inset 0 1px 0 var\(--elevation-highlight\), /u, '')).toMatch(/^(?:\d+ \d+px \d+px rgba\((?:0, 0, 0|16, 13, 36), 0\.\d+\)(?:, |$))+$/u)
      }
    }
  })

  it('bundles Geist Sans and Geist Mono for the shell, Home and the address overlay', () => {
    const repository = fileURLToPath(new URL('../', import.meta.url))
    for (const [family, file] of [['Geist', 'Geist-Variable.woff2'], ['Geist Mono', 'GeistMono-Variable.woff2']] as const) {
      expect(tokens).toMatch(new RegExp(`@font-face \\{\\s*font-family: "${family}";\\s*src: url\\("\\.\\./assets/fonts/${file}"\\) format\\("woff2"\\);\\s*font-weight: 100 900;`, 'u'))
      // Variable woff2 files start with the wOF2 signature.
      expect(readFileSync(join(rendererRoot, 'assets/fonts', file)).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
    expect(themeTokens('light').get('--font-ui')).toMatch(/^"Geist", /u)
    expect(themeTokens('light').get('--font-code')).toMatch(/^"Geist Mono", /u)
    for (const path of ['src/renderer/src/styles.css', 'src/renderer/src/address-overlay.css', 'src/renderer/src/styles/tokens.css', 'src/main/home-page-styles.ts']) {
      expect(readFileSync(join(repository, path), 'utf8'), path).not.toMatch(/(?:font-family|--font-sans):\s*Inter,/u)
    }
    expect(readFileSync(join(repository, 'src/main/home-page-styles.ts'), 'utf8')).toContain('font-family: "Geist", ')
    // The overlay's own CSP must let it load the bundled font; Home's protocol already serves woff2 under font-src.
    expect(readFileSync(join(repository, 'src/renderer/address-overlay.html'), 'utf8')).toContain("font-src 'self'")
    const notices = readFileSync(join(repository, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notices).toContain('**Geist Sans 1.800 and Geist Mono 1.700** (variable fonts, from the `geist` npm package 1.7.2)')
    expect(notices).toContain('Copyright 2024 The Geist Project Authors')
    expect(notices).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('leaves no literal font size or family, off-scale weight or literal corner from 6 px up in renderer styles', () => {
    const offenders = stylesheets().flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const found = [
        // Relative em sizes, such as code inside a sentence, follow their text and may stay.
        ...source.matchAll(/font-size:\s*\d*\.?\d+(?:px|rem)|\[font-size:\d*\.?\d+(?:px|rem)\]|(?<![\w-])text-\[\d*\.?\d+(?:px|rem)\]|(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])|\[font:[^\]]*\d+(?:px|rem)[^\]]*\]|(?<![\w[-])font:\s*[^;}\]]*?\d(?:px|rem)/gu),
        ...source.matchAll(/SFMono-Regular|Consolas|(?:font-family|--font-sans):\s*Inter\b/gu),
        ...source.matchAll(/font-weight:\s*(?!400\b|500\b|600\b)\d{3}|\[font-weight:\d{3}\]|(?<![\w-])font-\[\d{3}\]|(?<![\w-])font-(?:bold|semibold|extrabold|black)(?![\w-])/gu),
        // The corner scale starts at 6 px; small marks may keep a literal corner of 5 px or less.
        ...source.matchAll(/border-(?:(?:top|bottom)-(?:left|right)-)?radius:\s*(?:\d*\.?\d+px\s+)*(?:[6-9]|\d{2,})(?:\.\d+)?px|border-(?:(?:top|bottom)-(?:left|right)-)?radius:\s*[^;}\]]*?\d(?:r?em)\b|\[border-(?:(?:top|bottom)-(?:left|right)-)?radius:[^\]]*(?<![\d.])(?:[6-9]|\d{2,})px|(?<![\w-])rounded(?:-[tblr]{1,2})?-\[(?:[6-9]|\d{2,})px\]|(?<![\w-])rounded-(?:sm|md|lg|xl|2xl|3xl)(?![\w-])/gu)
      ]
      return found.map((match) => `${path.slice(rendererRoot.length)}: ${match[0]}`)
    })
    expect(offenders).toEqual([])
  })
})
