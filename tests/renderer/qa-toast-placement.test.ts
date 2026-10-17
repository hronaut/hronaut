import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import AppToastRegion from '../../src/renderer/src/components/AppToastRegion.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

// Regression coverage for #868 (toasts over the page column), deferred to the redesign QA pass. jsdom has no layout,
// so the region's own CSS expressions are read from the component and evaluated for real window and rail widths.

const source = readFileSync(join(process.cwd(), 'src/renderer/src/components/AppToastRegion.vue'), 'utf8')
const style = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map(([, css]) => css).join('\n').replace(/\/\*[\s\S]*?\*\//gu, '')

function declaration(body: string, property: string): string {
  const value = new RegExp(`(?:^|[;\\s{])${property}\\s*:\\s*([^;]+);`, 'u').exec(body)?.[1]?.trim()
  expect(value, property).toBeDefined()
  return value!
}

const regionRule = /(?:^|\n)\.app-toast-region\s*\{([^}]*)\}/u.exec(style)?.[1] ?? ''
const narrow = /@media \(max-width: (\d+)px\)\s*\{\s*\.app-toast-region\s*\{([^}]*)\}/u.exec(style)

/**
 * Evaluates the CSS math this region uses (calc, min, max, var with a fallback, px and vw) to pixels, so the test
 * follows the component's real expressions rather than a copy of them.
 */
function evaluate(expression: string, variables: Record<string, string>, viewportWidth: number): number {
  const tokens = expression.match(/[a-z-]+\(|--[\w-]+|\d+(?:\.\d+)?(?:px|vw)?|[-+*/(),]/gu) ?? []
  let position = 0
  const peek = (): string | undefined => tokens[position]
  const next = (): string => {
    const token = tokens[position++]
    if (token === undefined) throw new Error(`Unexpected end of ${expression}`)
    return token
  }
  const expect_ = (token: string): void => {
    const actual = next()
    if (actual !== token) throw new Error(`Expected ${token} but found ${actual} in ${expression}`)
  }
  function list(): number[] {
    const values = [sum()]
    while (peek() === ',') {
      next()
      values.push(sum())
    }
    expect_(')')
    return values
  }
  function primary(): number {
    const token = next()
    if (token === '(' || token === 'calc(') {
      const value = sum()
      expect_(')')
      return value
    }
    if (token === 'min(') return Math.min(...list())
    if (token === 'max(') return Math.max(...list())
    if (token === 'var(') {
      const name = next()
      let fallback: number | undefined
      if (peek() === ',') {
        next()
        fallback = sum()
      }
      expect_(')')
      const value = variables[name]
      if (value !== undefined) return evaluate(value, variables, viewportWidth)
      if (fallback === undefined) throw new Error(`${name} is not set`)
      return fallback
    }
    if (token === '-') return -primary()
    const number = /^(\d+(?:\.\d+)?)(px|vw)?$/u.exec(token)
    if (!number) throw new Error(`Unexpected ${token} in ${expression}`)
    return number[2] === 'vw' ? Number(number[1]) * viewportWidth / 100 : Number(number[1])
  }
  function product(): number {
    let value = primary()
    while (peek() === '*' || peek() === '/') value = next() === '*' ? value * primary() : value / primary()
    return value
  }
  function sum(): number {
    let value = product()
    while (peek() === '+' || peek() === '-') value = next() === '+' ? value + product() : value - product()
    return value
  }
  const result = sum()
  if (position !== tokens.length) throw new Error(`Unexpected ${peek()} in ${expression}`)
  return result
}

function placement(windowWidth: number, railWidth: number) {
  const variables: Record<string, string> = {
    '--toast-rail-width': `${railWidth}px`,
    '--toast-column': declaration(regionRule, '--toast-column')
  }
  const narrowWidth = narrow && windowWidth <= Number(narrow[1]) ? declaration(narrow[2], 'width') : undefined
  const width = evaluate(narrowWidth ?? declaration(regionRule, 'width'), variables, windowWidth)
  const center = evaluate(declaration(regionRule, 'left'), variables, windowWidth)
  return { left: center - width / 2, right: center + width / 2, width, center }
}

describe('toast placement over the page column', () => {
  it('anchors the region at its center, fixed to the top of the window, letting clicks pass around the toast', () => {
    expect(declaration(regionRule, 'position')).toBe('fixed')
    expect(declaration(regionRule, 'transform')).toBe('translateX(-50%)')
    expect(declaration(regionRule, 'pointer-events')).toBe('none')
    expect(narrow?.[1]).toBe('760')
  })

  it.each([
    [1280, 248], [1280, 0], [1920, 320], [1024, 248], [900, 248], [760, 248], [640, 200], [480, 0], [1440, 180]
  ])('keeps a %i px window\'s toast centered over the page column past a %i px rail', (windowWidth, railWidth) => {
    const column = windowWidth - railWidth
    const { left, right, width, center } = placement(windowWidth, railWidth)

    expect(center).toBeCloseTo(railWidth + column / 2, 5)
    // Never over the rail, never past the window's edge.
    expect(left).toBeGreaterThanOrEqual(railWidth + 8)
    expect(right).toBeLessThanOrEqual(windowWidth - 8)
    expect(width).toBeLessThanOrEqual(620)
  })

  it('leaves 140 px clear on each side of the column when there is room, up to the 620 px cap', () => {
    for (const column of [600, 700, 800, 900]) {
      const { left, right, width } = placement(column + 248, 248)
      expect(width, `column ${column}`).toBe(Math.min(620, column - 280))
      expect(left - 248, `column ${column}`).toBeGreaterThanOrEqual(140)
      expect(column + 248 - right, `column ${column}`).toBeGreaterThanOrEqual(140)
    }
    expect(placement(1600 + 248, 248).width).toBe(620)
  })

  it('keeps a 320 px floor on a mid-width column and spans the column on a narrow window', () => {
    expect(placement(248 + 560, 248).width).toBe(320)
    // At 760 px and below, the toast takes the column minus its 8 px margins.
    expect(placement(700, 248).width).toBe(700 - 248 - 16)
    expect(placement(700, 0).width).toBe(700 - 16)
  })

  it('places the toast as before without a rail', () => {
    const { center, width } = placement(1280, 0)
    expect(center).toBe(640)
    expect(width).toBe(620)
  })

  it('follows the rail width as it changes, such as entering full-page view', async () => {
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts: [], railWidth: 248 }
    })
    const region = view.container.querySelector<HTMLElement>('.app-toast-region')!
    expect(region.style.getPropertyValue('--toast-rail-width')).toBe('248px')

    await view.rerender({ railWidth: 0 })
    expect(region.style.getPropertyValue('--toast-rail-width')).toBe('0px')
    await view.rerender({ railWidth: 312 })
    expect(region.style.getPropertyValue('--toast-rail-width')).toBe('312px')
    view.unmount()
  })

  it('gets the same rail width the page column is offset by', () => {
    const app = readFileSync(join(process.cwd(), 'src/renderer/src/App.vue'), 'utf8')
    expect(app).toMatch(/<AppToastRegion\b[^>]*:rail-width="pageRailWidth"/u)
    expect(app).toMatch(/'--tab-rail-width': `\$\{pageRailWidth\}px`/u)
  })
})
