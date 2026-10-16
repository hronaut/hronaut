import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { WORKSPACE_TINT_PROPERTY, useWorkspaceShellTint } from '../../src/renderer/src/composables/useWorkspaceShellTint.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../src/shared/tab-groups.js'
import { RESOLVED_THEME_NAMES } from '../../src/shared/theme.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'

function workspace(id: string, color: BrowserTabGroupState['color']): BrowserTabGroupState {
  return {
    id,
    name: id,
    description: '',
    color,
    createdAt: '2026-10-16T09:00:00.000Z',
    lastUsedAt: '2026-10-16T09:00:00.000Z',
    tabCount: 1,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
  }
}

function tab(id: string, url: string, mcpGroupId?: string): BrowserTabState {
  return {
    id,
    title: id,
    url,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: false,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    mcpGroupId
  }
}

function browserState(activeTabId: string | null): BrowserState {
  return {
    tabs: [
      tab('home', 'hronaut://home'),
      tab('checkout', 'http://127.0.0.1:5173/checkout', 'acme'),
      tab('admin', 'http://127.0.0.1:5174/admin', 'northwind'),
      tab('loose', 'https://example.test/'),
      tab('orphan', 'https://example.test/orphan', 'gone')
    ],
    closedTabs: [],
    activeTabId,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47891/mcp',
    profilePath: '/tmp/hronaut-test',
    mcpTabGroups: [workspace('acme', 'green'), workspace('northwind', 'purple')],
    savedTabGroups: []
  }
}

const stylesRoot = join(process.cwd(), 'src/renderer/src/styles')

afterEach(() => document.documentElement.style.removeProperty(WORKSPACE_TINT_PROPERTY))

describe('workspace shell tint', () => {
  it('takes the color of the workspace in view and goes neutral on Home, Settings and pages outside a workspace', async () => {
    const state = ref(browserState('checkout'))
    const settingsOpen = ref(false)
    const scope = effectScope()
    scope.run(() => useWorkspaceShellTint({ state, settingsOpen, detachedWindow: false }))
    const tint = () => document.documentElement.style.getPropertyValue(WORKSPACE_TINT_PROPERTY)
    expect(tint()).toBe(BROWSER_TAB_GROUP_COLOR_HEX.green)

    state.value = { ...state.value, activeTabId: 'admin' }
    await nextTick()
    expect(tint()).toBe(BROWSER_TAB_GROUP_COLOR_HEX.purple)

    settingsOpen.value = true
    await nextTick()
    expect(tint()).toBe('')
    settingsOpen.value = false
    await nextTick()
    expect(tint()).toBe(BROWSER_TAB_GROUP_COLOR_HEX.purple)

    for (const activeTabId of ['home', 'loose', null]) {
      state.value = { ...state.value, activeTabId }
      await nextTick()
      expect(tint(), String(activeTabId)).toBe('')
    }

    // A tab whose workspace is not listed yet uses the same default color as its tab.
    state.value = { ...state.value, activeTabId: 'orphan' }
    await nextTick()
    expect(tint()).toMatch(/^#[0-9a-f]{6}$/u)

    scope.stop()
    expect(tint()).toBe('')
  })

  it('leaves a detached panel window neutral', () => {
    const scope = effectScope()
    scope.run(() => useWorkspaceShellTint({ state: ref(browserState('checkout')), settingsOpen: ref(false), detachedWindow: true }))
    expect(document.documentElement.style.getPropertyValue(WORKSPACE_TINT_PROPERTY)).toBe('')
    scope.stop()
  })
})

describe('workspace shell wash tokens', () => {
  const tokens = readFileSync(join(stylesRoot, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
  const blocks = [...tokens.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({
    selectors: selector.split(',').map((entry) => entry.trim()),
    body
  }))
  const themeValue = (theme: string, name: string): string | undefined => {
    let value: string | undefined
    for (const { selectors, body } of blocks) {
      const applies = selectors.includes(':root') || selectors.includes(`:root[data-theme="${theme}"]`)
        || (theme === 'light' && selectors.includes(':root[data-theme="light"]'))
      const match = applies ? new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(body)?.[1]?.trim() : undefined
      if (!match) continue
      // A theme's own block wins over the shared :root block.
      if (selectors.includes(`:root[data-theme="${theme}"]`) || value === undefined) value = match
    }
    return value
  }
  const rgb = (hex: string): number[] => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const luminance = (color: number[]): number => {
    const [r, g, b] = color.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: number[], b: number[]): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (high + 0.05) / (low + 0.05)
  }

  it('registers the tint as a color, so a workspace change crossfades instead of jumping', () => {
    expect(tokens).toMatch(/@property --workspace-tint\s*\{[^}]*syntax:\s*"<color>";[^}]*inherits:\s*true;[^}]*initial-value:\s*transparent;/u)
    const base = readFileSync(join(stylesRoot, 'base.css'), 'utf8')
    expect(base).toMatch(/:root\s*\{\s*transition:\s*--workspace-tint 600ms/u)
  })

  it('keeps muted text at 4.5:1 on the strongest point of the wash in every theme and workspace color', () => {
    for (const theme of RESOLVED_THEME_NAMES) {
      const strength = Number.parseFloat(themeValue(theme, '--shell-wash-strength') ?? '') / 100
      const muted = themeValue(theme, '--muted')
      const surface = themeValue(theme, '--shell-bottom')
      expect(strength, theme).toBeGreaterThan(0)
      expect(muted, theme).toMatch(/^#[0-9a-f]{6}$/u)
      expect(surface, theme).toMatch(/^#[0-9a-f]{6}$/u)
      for (const [name, color] of Object.entries(BROWSER_TAB_GROUP_COLOR_HEX)) {
        const washed = rgb(surface!).map((channel, index) => rgb(color)[index] * strength + channel * (1 - strength))
        expect(contrast(rgb(muted!), washed), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
