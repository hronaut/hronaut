import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DownloadSettingsPanel from '../../src/renderer/src/features/downloads/DownloadSettingsPanel.vue'
import { useDownloadSettingsController } from '../../src/renderer/src/features/downloads/useDownloadSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import UiCheckbox from '../../src/renderer/src/ui/UiCheckbox.vue'
import type { AppSettings } from '../../src/shared/types.js'
import { RESOLVED_THEME_NAMES } from '../../src/shared/theme.js'

// Regression coverage for #866 (v2 Settings switches), deferred to the redesign QA pass. jsdom computes no styles, so
// the drawing is checked from the stylesheets: which tokens the switch uses and how they contrast in every theme.

describe('UiCheckbox switch appearance', () => {
  it('draws a bare switch that is still a checkbox to assistive technology', async () => {
    const view = render(UiCheckbox, {
      props: { bare: true, appearance: 'switch', modelValue: false },
      attrs: { id: 'setting-agent-cursor', 'aria-label': 'Show the agent cursor' }
    })
    const control = screen.getByRole('checkbox', { name: 'Show the agent cursor' })

    expect(control).toHaveClass('ui-checkbox', 'ui-checkbox--switch')
    expect(control).toHaveAttribute('id', 'setting-agent-cursor')
    expect(control).not.toHaveAttribute('role')
    expect(screen.queryByRole('switch')).toBeNull()
    await userEvent.setup().click(control)
    expect(view.emitted()['update:modelValue']).toEqual([[true]])
  })

  it('draws a labeled switch whose label still names the checkbox', async () => {
    const view = render(UiCheckbox, {
      props: { label: 'Check for updates automatically', appearance: 'switch', checked: true }
    })
    const control = screen.getByRole('checkbox', { name: 'Check for updates automatically' })

    expect(control).toHaveClass('ui-checkbox--switch')
    expect(control).toBeChecked()
    expect(control.closest('label')).toHaveClass('ui-check')
    await userEvent.setup().click(screen.getByText('Check for updates automatically'))
    expect(view.emitted()['update:modelValue']).toEqual([[false]])
  })

  it.each([true, false])('keeps a plain checkbox without the switch class (bare: %s)', (bare) => {
    render(UiCheckbox, { props: { bare, label: 'Remember', modelValue: false }, attrs: { 'aria-label': 'Remember' } })
    const control = screen.getByRole('checkbox', { name: 'Remember' })

    expect(control).not.toHaveClass('ui-checkbox--switch')
    if (bare) expect(control).toHaveClass('ui-checkbox')
  })

  it('keeps a disabled labeled switch disabled and marked', () => {
    render(UiCheckbox, { props: { label: 'Use system title bar', appearance: 'switch', disabled: true } })
    const control = screen.getByRole('checkbox', { name: 'Use system title bar' })

    expect(control).toBeDisabled()
    expect(control).toHaveClass('ui-checkbox--switch')
    expect(control.closest('label')).toHaveClass('ui-check--disabled')
  })

  it('shows a Settings row that applies at once as a switch, with its label and change handler', async () => {
    const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS, askWhereToSaveDownloads: false })
    const api = {
      chooseDownloadDirectory: vi.fn(async () => ({ canceled: true, settings: settings.value })),
      setAskWhereToSaveDownloads: vi.fn(async (enabled: boolean) => ({ ...settings.value, askWhereToSaveDownloads: enabled })),
      resetDownloads: vi.fn(async () => settings.value),
      openDownloadDirectory: vi.fn(async () => undefined)
    }
    const controller = useDownloadSettingsController({
      api,
      settings,
      defaultDirectory: ref('/home/test/Downloads'),
      applySettings: (next) => { settings.value = next },
      translate: (key) => key
    })
    render(DownloadSettingsPanel, { global: { plugins: [createHronautI18n('en-US')] }, props: { controller } })
    const control = screen.getByRole('checkbox', { name: /^Ask where to save each file/ })

    expect(control).toHaveClass('ui-checkbox', 'ui-checkbox--switch')
    expect(control.closest('.settings-rows')).not.toBeNull()
    await userEvent.setup().click(control)
    expect(api.setAskWhereToSaveDownloads).toHaveBeenCalledWith(true)
  })
})

const stylesRoot = join(process.cwd(), 'src/renderer/src/styles')
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '')
const controls = withoutComments(readFileSync(join(stylesRoot, 'controls.css'), 'utf8'))
const tokens = withoutComments(readFileSync(join(stylesRoot, 'tokens.css'), 'utf8'))

/** The body of the first rule with exactly this selector, outside media queries unless `css` is a media block. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const body = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1]
  expect(body, selector).toBeDefined()
  return body!
}

/** The CSS variable a declaration reads, such as `--muted` from `border: 1px solid var(--muted)`. */
function tokenOf(body: string, property: string): string {
  const value = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`, 'u').exec(body)?.[1]
  const token = value ? /var\((--[\w-]+)\)/u.exec(value)?.[1] : undefined
  expect(token, `${property} in { ${body.trim()} }`).toBeDefined()
  return token!
}

/** The body of a top-level `@media (<query>) { ... }` block. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media (${query})`)
  expect(start, query).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index)
  }
  throw new Error(`Unclosed @media (${query})`)
}

/** Selectors split at top-level commas, so `:not(a, b)` stays one selector. */
function selectorList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const character of selector) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += character
  }
  parts.push(current.trim())
  return parts.filter(Boolean)
}

/** A theme's own token values: `:root` first, then the theme's more specific blocks. */
function themeTokens(theme: string): Map<string, string> {
  const values = new Map<string, string>()
  const unconditional = tokens.replace(/@media[^{]+\{[\s\S]*?\n\}/gu, '')
  for (const target of [':root', `:root[data-theme="${theme}"]`]) {
    for (const [, selector, body] of unconditional.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if (!selector.split(',').map((entry) => entry.trim()).includes(target)) continue
      for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) values.set(name, value.trim())
    }
  }
  return values
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

const SWITCH = 'input[type="checkbox"].ui-checkbox--switch'

describe('switch drawing in every theme', () => {
  const off = ruleBody(controls, SWITCH)
  const knob = ruleBody(controls, `${SWITCH}::before`)
  const on = ruleBody(controls, `${SWITCH}:checked`)
  const onKnob = ruleBody(controls, `${SWITCH}:checked::before`)
  const parts = {
    offOutline: tokenOf(off, 'border'),
    offTrack: tokenOf(off, 'background-color'),
    offKnob: tokenOf(knob, 'background-color'),
    onTrack: tokenOf(on, 'background-color'),
    onKnob: tokenOf(onKnob, 'background-color')
  }

  it('draws a 38 × 22 track with a 16 px knob that moves 16 px when on', () => {
    expect(off).toMatch(/appearance:\s*none;/u)
    expect(off).toMatch(/(?:^|[;\s])width:\s*38px;/u)
    expect(off).toMatch(/(?:^|[;\s])height:\s*22px;/u)
    expect(off).toMatch(/border-radius:\s*var\(--corner-pill\);/u)
    expect(knob).toMatch(/(?:^|[;\s])width:\s*16px;/u)
    expect(knob).toMatch(/(?:^|[;\s])height:\s*16px;/u)
    expect(onKnob).toMatch(/translate:\s*16px 0;/u)
    expect(tokenOf(on, 'border-color')).toBe(parts.onTrack)
  })

  it('sits on the Settings card surface', () => {
    const settings = withoutComments(readFileSync(join(stylesRoot, 'settings.css'), 'utf8'))
    expect(ruleBody(settings, '.settings-rows')).toMatch(/(?:^|\s)bg-surface(?:\s|;)/u)
  })

  it.each(RESOLVED_THEME_NAMES)('keeps the switch parts at 3:1 or more in the %s theme', (theme) => {
    const values = themeTokens(theme)
    const color = (token: string): string => {
      const value = values.get(token)
      expect(value, `${theme} ${token}`).toMatch(/^#[0-9a-f]{6}$/u)
      return value!
    }
    const card = color('--surface')
    const failures: string[] = []
    const check = (name: string, front: string, back: string): void => {
      const ratio = contrast(front, back)
      if (ratio < 3) failures.push(`${name} is ${ratio.toFixed(2)}:1`)
    }
    check(`off outline ${parts.offOutline} on the card`, color(parts.offOutline), card)
    check(`off knob ${parts.offKnob} on its track ${parts.offTrack}`, color(parts.offKnob), color(parts.offTrack))
    check(`on track ${parts.onTrack} on the card`, color(parts.onTrack), card)
    check(`on knob ${parts.onKnob} on its track ${parts.onTrack}`, color(parts.onKnob), color(parts.onTrack))
    expect(failures).toEqual([])
  })

  it('draws UiSwitch, used in the primitives stories, with the same tokens', () => {
    const primitives = withoutComments(readFileSync(join(stylesRoot, 'primitives.css'), 'utf8'))
    const theme = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const utilityToken = (utility: string): string => {
      const name = /^(?:bg|border)-(.+)$/u.exec(utility)?.[1]
      const token = name ? new RegExp(`--color-${name}:\\s*var\\((--[\\w-]+)\\);`, 'u').exec(theme)?.[1] : undefined
      expect(token, utility).toBeDefined()
      return token!
    }
    const utilities = (selector: string): string[] => ruleBody(primitives, selector).replace(/@apply|;/gu, ' ').trim().split(/\s+/u)
    const track = utilities('.ui-switch__track')
    const trackKnob = utilities('.ui-switch__track > span')
    const checkedTrack = utilities('.ui-switch__input:checked + .ui-switch__track')
    const checkedKnob = utilities('.ui-switch__input:checked + .ui-switch__track > span')

    expect(track.filter((utility) => /^border-(?!0)[a-z]/u.test(utility) && utility !== 'border').map(utilityToken)).toEqual([parts.offOutline])
    expect(track.filter((utility) => utility.startsWith('bg-')).map(utilityToken)).toEqual([parts.offTrack])
    expect(trackKnob.filter((utility) => utility.startsWith('bg-')).map(utilityToken)).toEqual([parts.offKnob])
    expect(checkedTrack.filter((utility) => utility.startsWith('bg-')).map(utilityToken)).toEqual([parts.onTrack])
    expect(checkedKnob.filter((utility) => utility.startsWith('bg-')).map(utilityToken)).toEqual([parts.onKnob])
  })

  it('keeps every generic checkbox rule off the switch', () => {
    const offenders = [...controls.replace(/@media[^{]+\{/gu, '').matchAll(/([^{}]+)\{[^{}]*\}/gu)]
      .flatMap(([, selector]) => selectorList(selector))
      .filter((selector) => /type="checkbox"/u.test(selector) && !selector.includes('ui-checkbox--switch'))
    expect(offenders).toEqual([])
  })

  it('falls back to the system checkbox under forced colors', () => {
    const forced = mediaBlock(controls, 'forced-colors: active')
    const box = ruleBody(forced, SWITCH)
    expect(box).toMatch(/appearance:\s*auto;/u)
    expect(box).toMatch(/(?:^|[;\s])width:\s*16px;/u)
    expect(box).toMatch(/(?:^|[;\s])height:\s*16px;/u)
    expect(ruleBody(forced, `${SWITCH}::before`)).toMatch(/content:\s*none;/u)
  })

  it('moves without transitions under reduced motion', () => {
    expect(off).toMatch(/transition:[^;]*var\(--motion-fast\)/u)
    expect(knob).toMatch(/transition:[^;]*translate var\(--motion-fast\)/u)
    const reduced = mediaBlock(controls, 'prefers-reduced-motion: reduce')
    const rule = /([^{}]+)\{([^{}]*)\}/gu
    const covered = [...reduced.matchAll(rule)]
      .filter(([, , body]) => /transition:\s*none;/u.test(body))
      .flatMap(([, selector]) => selectorList(selector))
    expect(covered).toEqual(expect.arrayContaining([SWITCH, `${SWITCH}::before`]))
  })
})
