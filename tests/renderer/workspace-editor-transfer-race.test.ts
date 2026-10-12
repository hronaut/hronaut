import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceEditor from '../../src/renderer/src/components/WorkspaceEditor.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState } from '../../src/shared/types.js'

const originalBrowser = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => {
  if (originalBrowser) Object.defineProperty(window, 'hronaut', originalBrowser)
  else Reflect.deleteProperty(window, 'hronaut')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}

function stateWith(ids = ['old', 'new', 'choice']): BrowserState {
  return {
    tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false,
    mcpUrl: '', profilePath: '', savedTabGroups: [],
    mcpTabGroups: ids.map(id => ({ id, name: `${id} workspace`, description: '', color: 'purple',
      createdAt: '', lastUsedAt: '', tabCount: 0, activeTabId: null, storageOriginCount: 0,
      navigationPolicy: { mode: 'unrestricted', rules: [] } }))
  }
}

function setup(initial = stateWith(), refreshed = initial) {
  const browser = {
    getState: vi.fn(async () => refreshed),
    listWorkspaceStorageOrigins: vi.fn(async () => [] as string[]),
    listWorkspaceNavigationAudit: vi.fn(async () => [])
  }
  Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
  const wrapper = mount(WorkspaceEditor, {
    global: { plugins: [createHronautI18n('en-US')], stubs: {
      WorkspaceContinuityPanel: true, HumanWaitingPanel: true,
      BrowserImportPanel: { props: ['workspaceId'], template: '<div data-test="import-target">{{ workspaceId }}</div>' }
    } },
    props: { open: false, state: initial, canPresent: true, formatNumber: String,
      syncState: async (next: BrowserState | Promise<BrowserState>) => { await wrapper.setProps({ state: await next }) },
      'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } }
  })
  const editor = wrapper.vm as unknown as {
    openTransfer: (id?: string) => Promise<void>
    openExisting: (id: string) => Promise<void>
  }
  const destination = () => wrapper.get<HTMLSelectElement>('#browser-import-destination').element.value
  return { browser, wrapper, editor, destination }
}

describe('workspace transfer presentation ownership', () => {
  for (const phase of ['state', 'origins'] as const) {
    it.each(['success', 'failure'] as const)(`preserves a newer editor destination after stale transfer ${phase} %s`, async outcome => {
      const { browser, wrapper, editor, destination } = setup()
      const state = deferred<BrowserState>()
      const origins = deferred<string[]>()
      if (phase === 'state') browser.getState.mockReturnValueOnce(state.promise)
      else browser.listWorkspaceStorageOrigins.mockReturnValueOnce(origins.promise)
      try {
        const older = editor.openTransfer('old')
        await flushPromises()
        await editor.openExisting('new')
        await flushPromises()
        expect(destination()).toBe('new')
        if (phase === 'state') {
          if (outcome === 'success') state.resolve(stateWith())
          else state.reject(new Error('Obsolete state read'))
        } else if (outcome === 'success') origins.resolve(['https://stale.example'])
        else origins.reject(new Error('Obsolete origin read'))
        await expect(older).resolves.toBeUndefined()
        await flushPromises()
        expect(wrapper.get<HTMLInputElement>('#tab-group-name').element.value).toBe('new workspace')
        expect(destination()).toBe('new')
      } finally { wrapper.unmount() }
    })
  }

  it.each(['success', 'failure'] as const)('preserves a user-selected import destination after origin loading %s', async outcome => {
    const { browser, wrapper, editor, destination } = setup()
    const origins = deferred<string[]>()
    browser.listWorkspaceStorageOrigins.mockReturnValueOnce(origins.promise)
    try {
      const opening = editor.openTransfer('old')
      await flushPromises()
      await wrapper.get('#browser-import-destination').setValue('choice')
      expect(destination()).toBe('choice')
      if (outcome === 'success') origins.resolve(['https://source.example'])
      else origins.reject(new Error('Origin inventory unavailable'))
      await opening
      await flushPromises()
      expect(destination()).toBe('choice')
      const importButton = wrapper.findAll('button').find(button => button.text() === 'Import from browser…')!
      await importButton.trigger('click')
      expect(wrapper.get('[data-test="import-target"]').text()).toBe('choice')
    } finally { wrapper.unmount() }
  })

  it('keeps the newer transfer destination when older state loading finishes last', async () => {
    const { browser, wrapper, editor, destination } = setup()
    const pending = deferred<BrowserState>()
    browser.getState.mockReturnValueOnce(pending.promise)
    try {
      const older = editor.openTransfer('old')
      await editor.openTransfer('new')
      await flushPromises()
      expect(destination()).toBe('new')
      pending.resolve(stateWith())
      await older
      await flushPromises()
      expect(destination()).toBe('new')
      expect(wrapper.get<HTMLSelectElement>('#workspace-transfer-source').element.value).toBe('new')
    } finally { wrapper.unmount() }
  })

  it.each([undefined, 'new'])('initializes destination %s from the accepted refreshed state', async preferred => {
    const { wrapper, editor, destination } = setup(stateWith([]), stateWith())
    try {
      await editor.openTransfer(preferred)
      await flushPromises()
      expect(destination()).toBe(preferred ?? 'old')
    } finally { wrapper.unmount() }
  })

  it('initializes the current error presentation without reusing the prior editor destination', async () => {
    const { browser, wrapper, editor, destination } = setup()
    try {
      await editor.openExisting('new')
      browser.getState.mockRejectedValueOnce(new Error('Current state read failed'))
      await editor.openTransfer('old')
      await flushPromises()
      expect(wrapper.text()).toContain('Current state read failed')
      expect(destination()).toBe('old')
    } finally { wrapper.unmount() }
  })
})
