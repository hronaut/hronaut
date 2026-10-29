import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HelpDialog from '../../src/renderer/src/components/HelpDialog.vue'
import WorkspaceEditor from '../../src/renderer/src/features/workspaces/WorkspaceEditor.vue'
import { useHelpDialogController } from '../../src/renderer/src/composables/useHelpDialogController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserWorkspaceNavigationPolicy } from '../../src/shared/types.js'

// Regression coverage for #867 (workspace editor cards and per-platform shortcut keys), deferred to the redesign QA
// pass. jsdom has no layout or animation, so the chevron and card drawing are checked from the stylesheets.

const t = createHronautI18n('en-US').global.t as (key: string) => string

async function openShortcuts(platform: string) {
  const controller = useHelpDialogController({ beforeOpen: vi.fn(), translate: (key) => t(key), platform })
  const view = render(HelpDialog, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      controller,
      currentVersion: '3.0.0',
      openUrl: vi.fn(async () => undefined),
      openSupportSettings: vi.fn(),
      releaseHistoryController: { openDialog: vi.fn() } as never,
      reportLayout: vi.fn()
    }
  })
  controller.openDialog('shortcuts')
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
  const keysOf = (label: string): string[] => {
    const row = screen.getByText(label, { selector: 'dt' }).closest('.shortcut-row')
    expect(row, label).not.toBeNull()
    return [...row!.querySelectorAll('kbd')].map((key) => key.textContent ?? '')
  }
  const allKeys = (): string[] => [...dialog.querySelectorAll('kbd')].map((key) => key.textContent ?? '')
  return { controller, view, dialog, keysOf, allKeys }
}

describe('Keyboard shortcuts keycaps per platform', () => {
  it('writes keys as macOS does, with only the macOS keys of shortcuts that differ there', async () => {
    const { controller, view, keysOf, allKeys } = await openShortcuts('darwin')
    try {
      expect(keysOf('Focus the address bar')).toEqual(['⌘', 'L'])
      expect(keysOf('Reload without cached files')).toEqual(['⌘', '⇧', 'R'])
      expect(keysOf('Pick an element for agent context')).toEqual(['⌘', '⌥', 'C'])
      expect(keysOf('Open browsing history')).toEqual(['⌘', 'Y'])
      expect(keysOf('Toggle developer tools')).toEqual(['⌘', '⌥', 'I'])
      expect(keysOf('Clear browsing data')).toEqual(['⌘', '⇧', 'Delete'])
      expect(keysOf('Go to a pinned workspace (1–9 from the top)')).toEqual(['⌃', '1–9'])
      expect(keysOf('Go to the previous workspace (press again to go further back)')).toEqual(['⌃', '0'])
      expect(keysOf('Move to the next tab')).toEqual(['⌃', 'Tab'])
      expect(keysOf('Move to the previous tab')).toEqual(['⌃', '⇧', 'Tab'])
      expect(keysOf('Move to website tab 1–8')).toEqual(['⌘', '1–8'])
      expect(keysOf('Reset page zoom')).toEqual(['⌘', '0'])
      expect(allKeys().filter((key) => /Ctrl|Shift|Alt|Cmd|Option|Control|F12|\//u.test(key))).toEqual([])
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('writes keys in words elsewhere, with only that platform\'s keys', async () => {
    const { controller, view, dialog, keysOf, allKeys } = await openShortcuts('linux')
    try {
      expect(keysOf('Focus the address bar')).toEqual(['Ctrl', 'L'])
      expect(keysOf('Reload without cached files')).toEqual(['Ctrl', 'Shift', 'R'])
      expect(keysOf('Pick an element for agent context')).toEqual(['Ctrl', 'Shift', 'C'])
      expect(keysOf('Open browsing history')).toEqual(['Ctrl', 'H'])
      expect(keysOf('Toggle developer tools')).toEqual(['F12'])
      expect(keysOf('Go to a pinned workspace (1–9 from the top)')).toEqual(['Alt', '1–9'])
      expect(keysOf('Move to the previous tab')).toEqual(['Ctrl', 'Shift', 'Tab'])
      expect(keysOf('Move to website tab 1–8')).toEqual(['Ctrl', '1–8'])
      expect(allKeys().filter((key) => /[⌘⇧⌥⌃]|Cmd|Option|\//u.test(key))).toEqual([])
      expect(dialog.querySelectorAll('.shortcut-row')).toHaveLength(controller.shortcuts.value.length)
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('writes Windows keys the same way as Linux', async () => {
    const { controller, view, keysOf } = await openShortcuts('win32')
    try {
      expect(controller.mac).toBe(false)
      expect(keysOf('Reopen the last closed tab')).toEqual(['Ctrl', 'Shift', 'T'])
      expect(keysOf('Toggle developer tools')).toEqual(['F12'])
    } finally {
      view.unmount()
      controller.dispose()
    }
  })
})

const originalHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => {
  if (originalHronaut) Object.defineProperty(window, 'hronaut', originalHronaut)
  else Reflect.deleteProperty(window, 'hronaut')
})

function mountEditor(navigationPolicy: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }) {
  const state: BrowserState = {
    tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', savedTabGroups: [],
    mcpTabGroups: ['research', 'checkout'].map((id) => ({
      id, name: id === 'research' ? 'Research' : 'Checkout', description: '', color: 'purple' as const, createdAt: '', lastUsedAt: '',
      tabCount: 0, activeTabId: null, storageOriginCount: 0, navigationPolicy
    }))
  }
  Object.defineProperty(window, 'hronaut', { configurable: true, value: {
    getState: vi.fn(async () => state),
    listWorkspaceStorageOrigins: vi.fn(async () => []),
    listWorkspaceNavigationAudit: vi.fn(async () => [])
  } })
  const wrapper = mount(WorkspaceEditor, {
    attachTo: document.body,
    global: { plugins: [createHronautI18n('en-US')] },
    props: { open: false, state, canPresent: true, formatNumber: String, syncState: async () => undefined,
      'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } }
  })
  const editor = wrapper.vm as unknown as { openNew: () => Promise<void>; openExisting: (id: string) => Promise<void> }
  return { wrapper, editor }
}

describe('workspace editor cards', () => {
  it('puts the three workspace options in one card, as checkboxes because the editor saves with a button', async () => {
    const { wrapper, editor } = mountEditor()
    try {
      await editor.openExisting('research')
      await flushPromises()
      const cards = wrapper.findAll('section.workspace-options')
      expect(cards).toHaveLength(1)
      const rows = cards[0].findAll(':scope > label.workspace-storage-choice')
      expect(rows.map((row) => row.get('strong').text())).toEqual(['Allow direct agent access', 'Hide from left sidebar', 'Protect from deletion'])
      expect(cards[0].element.children).toHaveLength(3)
      for (const row of rows) {
        const boxes = row.findAll('input[type="checkbox"]')
        expect(boxes).toHaveLength(1)
        expect(boxes[0].classes()).not.toContain('ui-checkbox--switch')
      }
    } finally { wrapper.unmount() }
  })

  it('shows Website access, Continuity and Copy or move data as collapsible cards when editing, and only Website access when creating', async () => {
    const { wrapper, editor } = mountEditor()
    try {
      await editor.openExisting('research')
      await flushPromises()
      const sections = wrapper.findAll('details.workspace-editor-section')
      expect(sections.map((section) => section.get(':scope > summary strong').text()))
        .toEqual(['Website access', 'Continuity & human decisions', 'Copy or move website data'])
      for (const section of sections) {
        expect((section.element as HTMLDetailsElement).open).toBe(false)
        expect(section.get(':scope > summary > svg').attributes('aria-hidden')).toBe('true')
      }

      await wrapper.get('.panel-close').trigger('click')
      await editor.openNew()
      await flushPromises()
      expect(wrapper.findAll('details.workspace-editor-section').map((section) => section.get(':scope > summary strong').text()))
        .toEqual(['Website access'])
    } finally { wrapper.unmount() }
  })

  it('opens Website access for a restricted workspace and draws its allowed sites in the shared textarea', async () => {
    const { wrapper, editor } = mountEditor({ mode: 'restricted', rules: ['https://shop.example'] })
    try {
      await editor.openExisting('research')
      await flushPromises()
      expect(wrapper.get<HTMLDetailsElement>('.workspace-access-disclosure').element.open).toBe(true)
      const rules = wrapper.get<HTMLTextAreaElement>('#workspace-navigation-rules')
      expect(rules.element.tagName).toBe('TEXTAREA')
      expect(rules.classes()).toEqual(expect.arrayContaining(['ui-control', 'ui-textarea']))
      expect(rules.element.value).toBe('https://shop.example')
      expect(wrapper.get('label[for="workspace-navigation-rules"]').text()).not.toBe('')
    } finally { wrapper.unmount() }
  })

  it('draws the workspace pickers with the shared select, keeping their ids', async () => {
    const { wrapper, editor } = mountEditor()
    try {
      await editor.openExisting('research')
      await flushPromises()
      for (const id of ['#workspace-transfer-source', '#workspace-transfer-target']) {
        const select = wrapper.get(id)
        expect(select.element.tagName, id).toBe('SELECT')
        expect(select.classes(), id).toEqual(expect.arrayContaining(['ui-control', 'ui-select']))
      }
      await wrapper.get('.panel-close').trigger('click')
      await editor.openNew()
      await flushPromises()
      await wrapper.get('input[value="fork-workspace"]').setValue(true)
      expect(wrapper.get('#workspace-fork-source').classes()).toEqual(expect.arrayContaining(['ui-control', 'ui-select']))
    } finally { wrapper.unmount() }
  })
})

const stylesRoot = join(process.cwd(), 'src/renderer/src/styles')
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '')
const workspaces = withoutComments(readFileSync(join(stylesRoot, 'workspaces.css'), 'utf8'))

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const body = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1]
  expect(body, selector).toBeDefined()
  return body!
}

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

describe('workspace editor card styles', () => {
  it('turns the section chevron with the motion tokens as the section opens', () => {
    const chevron = ruleBody(workspaces, '.workspace-editor-section > summary::after')
    expect(chevron).toMatch(/rotate:\s*-45deg;/u)
    expect(chevron).toMatch(/transition:\s*rotate var\(--motion-fast\) var\(--motion-ease-out\);/u)
    expect(ruleBody(workspaces, '.workspace-editor-section[open] > summary::after')).toMatch(/rotate:\s*45deg;/u)
    // The native disclosure marker is replaced by the chevron.
    expect(ruleBody(workspaces, '.workspace-editor-section > summary')).toMatch(/list-style:\s*none;/u)
    expect(ruleBody(workspaces, '.workspace-editor-section > summary::-webkit-details-marker')).toMatch(/display:\s*none;/u)
  })

  it('turns the chevron without a transition under reduced motion', () => {
    const reduced = mediaBlock(workspaces, 'prefers-reduced-motion: reduce')
    expect(ruleBody(reduced, '.workspace-editor-section > summary::after')).toMatch(/transition:\s*none;/u)
  })

  it('draws the sections and the options card as Settings cards, with a hairline between options', () => {
    for (const selector of ['.workspace-editor-section', '.workspace-options']) {
      const card = ruleBody(workspaces, selector)
      expect(card, selector).toMatch(/border:\s*1px solid var\(--border-soft\);/u)
      expect(card, selector).toMatch(/border-radius:\s*var\(--corner-3\);/u)
      expect(card, selector).toMatch(/background:\s*var\(--surface\);/u)
      expect(card, selector).toMatch(/box-shadow:\s*var\(--elevation-1\);/u)
    }
    expect(ruleBody(workspaces, '.workspace-editor-section > summary')).toMatch(/min-height:\s*56px;/u)
    expect(ruleBody(workspaces, '.workspace-options > .workspace-storage-choice + .workspace-storage-choice'))
      .toMatch(/border-top:\s*1px solid var\(--border-soft\);/u)
    expect(ruleBody(workspaces, '.workspace-options > .workspace-storage-choice')).toMatch(/border:\s*0;/u)
  })

  it('keeps a visible system focus outline on the editor\'s shared controls under forced colors', () => {
    const editorFocus = ruleBody(workspaces, '.workspace-editor .ui-control:focus-visible')
    // The editor's own focus ring is a shadow, which forced colors drop; it must not clear the primitives' outline.
    expect(editorFocus).not.toMatch(/(?:^|[;\s])outline\s*:/u)
    const primitives = withoutComments(readFileSync(join(stylesRoot, 'primitives.css'), 'utf8'))
    const forced = mediaBlock(primitives, 'forced-colors: active')
    expect(forced).toMatch(/\.ui-control:focus-visible[^{]*\{[^}]*outline:\s*2px solid Highlight;/u)
  })
})
