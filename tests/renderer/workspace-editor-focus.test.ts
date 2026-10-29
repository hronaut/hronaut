import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceEditor from '../../src/renderer/src/features/workspaces/WorkspaceEditor.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

// JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
function dropFocusLikeChromium(control: HTMLElement): void {
  control.removeAttribute('disabled')
  control.blur()
  control.setAttribute('disabled', '')
  expect(document.body).toHaveFocus()
}

const state: BrowserState = {
  tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '',
  mcpTabGroups: ['first', 'second'].map(id => ({ id, name: `${id} workspace`, description: '', color: 'purple' as const,
    createdAt: '', lastUsedAt: '', tabCount: 0, activeTabId: null, storageOriginCount: 1,
    navigationPolicy: { mode: 'unrestricted' as const, rules: [] } })),
  savedTabGroups: []
}

const originalBrowser = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => {
  vi.restoreAllMocks()
  if (originalBrowser) Object.defineProperty(window, 'hronaut', originalBrowser)
  else Reflect.deleteProperty(window, 'hronaut')
})

async function openEditor(browser: Record<string, unknown>, mode: 'edit' | 'transfer' = 'edit') {
  Object.defineProperty(window, 'hronaut', { configurable: true, value: {
    getState: vi.fn(async () => state),
    listWorkspaceStorageOrigins: vi.fn(async () => ['https://example.test']),
    listWorkspaceNavigationAudit: vi.fn(async () => []),
    ...browser
  } })
  const wrapper = mount(WorkspaceEditor, {
    attachTo: document.body,
    global: { plugins: [createHronautI18n('en-US')], stubs: { WorkspaceContinuityPanel: true, HumanWaitingPanel: true } },
    props: { open: false, state, canPresent: true, formatNumber: String,
      syncState: async (next: Promise<BrowserState> | BrowserState) => { await next },
      'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } }
  })
  const editor = wrapper.vm as unknown as { openExisting: (id: string) => Promise<void>; openTransfer: (id?: string) => Promise<void> }
  if (mode === 'edit') await editor.openExisting('second')
  else await editor.openTransfer('first')
  await flushPromises()
  return wrapper
}

describe('workspace editor focus after an action', () => {
  // Saving, closing or copying data disabled every control of the editor, Chromium moved the focus of the one you used
  // to the document body, and nothing gave it back while the editor stayed open: after a failed save or a finished
  // copy, the next Tab started outside the dialog and Enter or Space did nothing.
  it('gives the focus back to the workspace name after Enter fails to save it', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const saving = deferred<BrowserState>()
    const wrapper = await openEditor({ updateTabGroup: vi.fn(() => saving.promise) })
    try {
      const name = wrapper.get<HTMLInputElement>('#tab-group-name').element
      name.focus()
      await wrapper.get('form').trigger('submit')
      expect(name.disabled).toBe(true)
      dropFocusLikeChromium(name)
      saving.reject(new Error('Name already in use'))
      await flushPromises()
      expect(wrapper.get('.workspace-editor-error').text()).toContain('Name already in use')
      expect(name.disabled).toBe(false)
      expect(name).toHaveFocus()
    } finally { wrapper.unmount() }
  })

  it('gives the focus back to Copy selected data once the copy finishes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const copying = deferred<{ cookieCount: number; localStorageItemCount: number }>()
    const wrapper = await openEditor({ transferWorkspaceStorage: vi.fn(() => copying.promise) }, 'transfer')
    try {
      const copy = wrapper.get<HTMLButtonElement>('.workspace-transfer-button').element
      expect(copy.disabled).toBe(false)
      copy.focus()
      copy.click()
      await flushPromises()
      expect(copy.disabled).toBe(true)
      dropFocusLikeChromium(copy)
      copying.resolve({ cookieCount: 2, localStorageItemCount: 3 })
      await flushPromises()
      expect(copy.disabled).toBe(false)
      expect(copy).toHaveFocus()
    } finally { wrapper.unmount() }
  })

  // A failed copy keeps Copy selected data disabled. The editor itself takes the focus, not its Close button, where a
  // held Enter would close the editor and lose an unsaved rename.
  it('gives the focus to the editor, not its Close button, when a failed copy keeps Copy selected data disabled', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const copying = deferred<{ cookieCount: number; localStorageItemCount: number }>()
    const updateTabGroup = vi.fn(async () => state)
    const wrapper = await openEditor({ transferWorkspaceStorage: vi.fn(() => copying.promise), updateTabGroup })
    try {
      await wrapper.get('#tab-group-name').setValue('Renamed workspace')
      const copy = wrapper.get<HTMLButtonElement>('.workspace-transfer-button').element
      copy.focus()
      copy.click()
      await flushPromises()
      expect(copy.disabled).toBe(true)
      dropFocusLikeChromium(copy)
      copying.reject(new Error('Copy failed'))
      await flushPromises()
      expect(copy.disabled).toBe(true)
      expect(wrapper.get('form').element).toHaveFocus()
      expect(wrapper.get('.panel-close').element).not.toHaveFocus()
      expect(wrapper.emitted<[boolean]>('update:open')?.filter(([open]) => !open) ?? []).toEqual([])
      expect(updateTabGroup).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('gives the focus back to Close workspace once closing it fails', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const closing = deferred<BrowserState>()
    const wrapper = await openEditor({ closeWorkspace: vi.fn(() => closing.promise) })
    try {
      const close = wrapper.get<HTMLButtonElement>('.workspace-danger-zone button').element
      close.focus()
      close.click()
      await flushPromises()
      expect(close.disabled).toBe(true)
      dropFocusLikeChromium(close)
      closing.reject(new Error('Workspace is busy'))
      await flushPromises()
      expect(close.disabled).toBe(false)
      expect(close).toHaveFocus()
    } finally { wrapper.unmount() }
  })

  it('leaves newer focus and a background window alone', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const copying = deferred<{ cookieCount: number; localStorageItemCount: number }>()
    const wrapper = await openEditor({ transferWorkspaceStorage: vi.fn(() => copying.promise) }, 'transfer')
    try {
      const copy = wrapper.get<HTMLButtonElement>('.workspace-transfer-button').element
      copy.focus()
      copy.click()
      await flushPromises()
      dropFocusLikeChromium(copy)
      copying.resolve({ cookieCount: 2, localStorageItemCount: 3 })
      await flushPromises()
      expect(document.body).toHaveFocus()

      hasFocus.mockReturnValue(true)
      const again = deferred<{ cookieCount: number; localStorageItemCount: number }>()
      ;(window.hronaut.transferWorkspaceStorage as ReturnType<typeof vi.fn>).mockReturnValueOnce(again.promise)
      copy.focus()
      copy.click()
      await flushPromises()
      dropFocusLikeChromium(copy)
      const disclosure = wrapper.get<HTMLElement>('.workspace-data-disclosure summary').element
      disclosure.focus()
      again.resolve({ cookieCount: 1, localStorageItemCount: 1 })
      await flushPromises()
      expect(disclosure).toHaveFocus()
    } finally { wrapper.unmount() }
  })
})
