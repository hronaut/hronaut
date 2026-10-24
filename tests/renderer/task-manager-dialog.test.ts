import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TaskManagerDialog from '../../src/renderer/src/components/TaskManagerDialog.vue'
import { useTaskManagerController } from '../../src/renderer/src/composables/useTaskManagerController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState, TaskManagerProcess } from '../../src/shared/types.js'

function process(pid: number, overrides: Partial<TaskManagerProcess> = {}): TaskManagerProcess {
  return { pid, kind: 'page', tabIds: [], subframes: [], devToolsTabIds: [], memoryBytes: 0, cpuPercent: 0, canEnd: false, ...overrides }
}

function tab(id: string, title: string, mcpGroupId: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return { id, title, url: `https://${id}.example/`, mcpGroupId, sleeping: false, ...overrides } as BrowserTabState
}

const PROCESSES = [
  process(10, { kind: 'browser', memoryBytes: 200 * 1024 * 1024, cpuPercent: 1.25 }),
  process(20, { kind: 'gpu', memoryBytes: 100 * 1024 * 1024 }),
  process(30, { kind: 'utility', name: 'Network Service', memoryBytes: 50 * 1024 * 1024 }),
  process(40, { kind: 'interface', memoryBytes: 150 * 1024 * 1024, cpuPercent: 3 }),
  process(51, { tabIds: ['docs', 'mail'], memoryBytes: 300 * 1024 * 1024, cpuPercent: 0.5, canEnd: true }),
  process(52, { tabIds: ['nap'], memoryBytes: 10 * 1024 * 1024 }),
  process(53, { subframes: [{ tabId: 'docs', site: 'https://ads.example' }], devToolsTabIds: ['mail'], memoryBytes: 40 * 1024 * 1024, cpuPercent: 42 }),
  process(60, { kind: 'other', memoryBytes: 30 * 1024 * 1024 }),
  process(70, { kind: 'helper', name: 'Zygote', memoryBytes: 1024 * 1024 })
]

const TABS = [
  tab('docs', 'Project docs', 'work'),
  tab('mail', 'Inbox', 'home'),
  tab('nap', 'Old article', 'work', { sleeping: true })
]

function renderDialog(processes = PROCESSES, workspaces = [{ id: 'work', name: 'Client work' }, { id: 'home', name: 'Personal' }]) {
  const api = { list: vi.fn(async () => processes), endProcess: vi.fn(async () => undefined) }
  const controller = useTaskManagerController({ api, beforeOpen: vi.fn(), formatError: (error) => (error as Error).message, refreshMs: 60_000 })
  const formatBytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
  render(TaskManagerDialog, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller, tabs: TABS, workspaces, formatBytes, reportLayout: vi.fn() }
  })
  return { api, controller }
}

async function openDialog(processes = PROCESSES, workspaces?: Array<{ id: string; name: string }>) {
  const harness = renderDialog(processes, workspaces)
  harness.controller.openDialog()
  await flushPromises()
  return harness
}

function taskColumn(): string[] {
  return within(screen.getByRole('table')).getAllByRole('rowheader').map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
}

let controllers: Array<{ dispose(): void }> = []
afterEach(() => { for (const controller of controllers) controller.dispose(); controllers = [] })

describe('the Task manager dialog', () => {
  it('lists each process with its tasks, memory, CPU and process ID, as Chrome does', async () => {
    const { controller } = await openDialog()
    controllers.push(controller)
    const dialog = screen.getByRole('dialog', { name: 'Task manager' })
    expect(within(dialog).getByRole('columnheader', { name: 'Task' })).toHaveAttribute('aria-sort', 'ascending')
    expect(taskColumn()).toEqual([
      'Browser',
      'GPU process',
      'Utility: Network Service',
      'Hronaut window',
      // Tabs name their workspace when there are several.
      'Tab: Project docs Client work Tab: Inbox Personal',
      'Sleeping tab: Old article Client work',
      'Subframe: https://ads.example Client work DevTools: Inbox Personal',
      'Page process without a tab',
      'Helper: Zygote'
    ])
    const browser = within(dialog).getByRole('row', { name: /^Browser/ })
    expect(within(browser).getAllByRole('cell').map((cell) => cell.textContent.trim())).toEqual(['200 MB', '1.3', '10', ''])
    expect(within(dialog).getByText('9 processes using 881 MB')).toBeInTheDocument()
  })

  it('offers End process only for a process the list lets end, named by its first task', async () => {
    const { controller } = await openDialog()
    controllers.push(controller)
    expect(screen.getAllByRole('button', { name: /^End process/ }).map((button) => button.getAttribute('aria-label'))).toEqual(['End process: Tab: Project docs'])
  })

  it('leaves the workspace out when there is only one', async () => {
    const { controller } = await openDialog(PROCESSES.filter((entry) => entry.pid === 51), [{ id: 'work', name: 'Client work' }])
    controllers.push(controller)
    expect(taskColumn()).toEqual(['Tab: Project docs Tab: Inbox'])
  })

  it('sorts by a column, the largest memory and CPU first, the other way on a second click', async () => {
    const user = userEvent.setup()
    const { controller } = await openDialog()
    controllers.push(controller)
    const header = (name: string) => within(screen.getByRole('columnheader', { name })).getByRole('button')
    await user.click(header('Memory'))
    expect(screen.getByRole('columnheader', { name: 'Memory' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Task' })).toHaveAttribute('aria-sort', 'none')
    expect(taskColumn()[0]).toMatch(/^Tab: Project docs/)
    await user.click(header('Memory'))
    expect(screen.getByRole('columnheader', { name: 'Memory' })).toHaveAttribute('aria-sort', 'ascending')
    expect(taskColumn()[0]).toBe('Helper: Zygote')
    await user.click(header('CPU'))
    expect(taskColumn()[0]).toMatch(/^Subframe/)
    await user.click(header('Process ID'))
    expect(screen.getByRole('columnheader', { name: 'Process ID' })).toHaveAttribute('aria-sort', 'ascending')
    expect(taskColumn()[0]).toBe('Browser')
  })

  it('ends the process and keeps the focus in the dialog once its row leaves, off any other End process', async () => {
    const user = userEvent.setup()
    const remaining = [process(10, { kind: 'browser' }), process(52, { tabIds: ['mail'], canEnd: true })]
    const { api, controller } = await openDialog([process(10, { kind: 'browser' }), process(51, { tabIds: ['docs'], canEnd: true }), ...remaining.slice(1)])
    controllers.push(controller)
    api.list.mockResolvedValue(remaining)
    const end = screen.getByRole('button', { name: 'End process: Tab: Project docs' })
    end.focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(api.endProcess).toHaveBeenCalledWith(51)
    expect(screen.queryByRole('button', { name: 'End process: Tab: Project docs' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Task manager' }))
    expect(api.endProcess).toHaveBeenCalledOnce()
  })

  it('moves the focus to the dialog as End process starts, while its row stays until a later reading', async () => {
    const user = userEvent.setup()
    const listed = [process(10, { kind: 'browser' }), process(51, { tabIds: ['docs'], canEnd: true })]
    const { api, controller } = await openDialog(listed)
    controllers.push(controller)
    // The process is still on its way out when End process reads the list again.
    api.list.mockResolvedValueOnce(listed).mockResolvedValue([listed[0]])
    const end = screen.getByRole('button', { name: 'End process: Tab: Project docs' })
    end.focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(end).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: 'Task manager' })
    expect(document.activeElement).toBe(dialog)
    await controller.refresh()
    await flushPromises()
    expect(screen.queryByRole('button', { name: 'End process: Tab: Project docs' })).toBeNull()
    expect(document.activeElement).toBe(dialog)
  })

  it('ignores a held Enter on End process', async () => {
    const { api, controller } = await openDialog()
    controllers.push(controller)
    const end = screen.getByRole('button', { name: 'End process: Tab: Project docs' })
    end.focus()
    const held = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    end.dispatchEvent(held)
    await flushPromises()
    // The browser presses a button on its Enter keydown unless that is cancelled.
    expect(held.defaultPrevented).toBe(true)
    const first = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    end.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(false)
    expect(api.endProcess).not.toHaveBeenCalled()
  })

  it('shows a refused End process under the list', async () => {
    const user = userEvent.setup()
    const { api, controller } = await openDialog()
    controllers.push(controller)
    api.endProcess.mockRejectedValueOnce(new Error('This process cannot be ended; it may have ended already.'))
    await user.click(screen.getByRole('button', { name: 'End process: Tab: Project docs' }))
    await flushPromises()
    expect(screen.getByRole('alert')).toHaveTextContent('This process cannot be ended; it may have ended already.')
  })

  it('closes with its close button', async () => {
    const user = userEvent.setup()
    const { controller } = await openDialog()
    controllers.push(controller)
    await user.click(screen.getByRole('button', { name: 'Close Task manager' }))
    expect(controller.open.value).toBe(false)
  })
})
