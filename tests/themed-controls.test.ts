import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererRoot = fileURLToPath(new URL('../src/renderer/src/', import.meta.url))

function sources(directory = rendererRoot): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(css|vue)$/u.test(name) ? [path] : []
  })
}

/** Style rules as selector and body pairs, without comments or Vue templates. */
function rules(path: string): Array<{ selector: string; body: string }> {
  let source = readFileSync(path, 'utf8')
  if (path.endsWith('.vue')) source = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((match) => match[1]).join('\n')
  source = source.replace(/\/\*[\s\S]*?\*\//gu, '')
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }))
}

describe('themed native controls', () => {
  it('draws checkboxes, radio buttons and selects after the application styles', () => {
    const styles = readFileSync(join(rendererRoot, 'styles.css'), 'utf8')
    const layers = styles.match(/@layer ([^;]+);/u)?.[1]?.split(',').map((layer) => layer.trim()) ?? []
    expect(layers.indexOf('components')).toBeGreaterThan(layers.indexOf('application'))
    expect(styles).toContain("@import './styles/controls.css' layer(components);")
    expect(styles.indexOf("controls.css")).toBeGreaterThan(styles.lastIndexOf("layer(application)"))

    const controls = readFileSync(join(rendererRoot, 'styles/controls.css'), 'utf8')
    expect(controls).toContain('input:is([type="checkbox"], [type="radio"]):not([role="switch"], .ui-checkbox--switch) {')
    // Settings that apply at once draw the same checkbox as a switch, outside the generic checkbox rules.
    expect(controls).toMatch(/input\[type="checkbox"\]\.ui-checkbox--switch \{[^}]*appearance: none;[^}]*border: 1px solid var\(--muted\);/u)
    expect(controls).toMatch(/input\[type="checkbox"\]\.ui-checkbox--switch:checked::before \{[^}]*translate: 16px 0;/u)
    expect(controls).toContain('select:not([multiple], [size]) {')
    // High-contrast modes keep the system's own controls.
    expect(controls).toMatch(/@media \(forced-colors: active\) \{[\s\S]*appearance: auto;/u)
  })

  it('keeps every select chevron and checkbox size out of reach of broader component rules', () => {
    const offenders = sources().flatMap((path) => rules(path).flatMap(({ selector, body }) => {
      const found: string[] = []
      const selectsSelect = selector.split(',').some((part) => /(?:^|[\s>+~(])select(?![\w-])/u.test(part.trim()))
      // The background shorthand would clear the chevron drawn by controls.css.
      if (selectsSelect && /(?:^|[;\s])background\s*:/u.test(body)) found.push(`${selector}: background shorthand`)
      // Vue style blocks are unlayered, so a width here would stretch or shrink a themed checkbox.
      const bareInput = path.endsWith('.vue') && selector.split(',').some((part) => /(?:^|[\s>+~])input(?![\w[:-])/u.test(part.trim()))
      if (bareInput && /(?:^|[;\s])width\s*:/u.test(body)) found.push(`${selector}: width on every input`)
      return found.map((issue) => `${path.slice(rendererRoot.length)}: ${issue}`)
    }))
    expect(offenders).toEqual([])
  })
})
