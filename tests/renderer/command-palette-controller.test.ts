import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { CommandPaletteResultSection } from '../../src/shared/command-palette-search.js'
import { useCommandPaletteController } from '../../src/renderer/src/composables/useCommandPaletteController.js'

type Controller = ReturnType<typeof useCommandPaletteController>
type Search = (query: string) => readonly CommandPaletteResultSection[]

function createController(websiteAvailable = true, search?: Search, translate: (key: string) => string = (key) => key) {
  const open = ref(false)
  const website = ref(websiteAvailable)
  const runCommand = vi.fn(async () => undefined)
  const onRunError = vi.fn()
  const controller = useCommandPaletteController({
    open,
    websiteAvailable: website,
    translate,
    runCommand,
    onRunError,
    ...(search ? { search } : {})
  })
  return { open, website, runCommand, onRunError, controller }
}

function commandIndex(controller: Controller, id: string): number {
  return controller.entries.value.findIndex((entry) => entry.kind === 'command' && entry.command.id === id)
}

function selectedId(controller: Controller): string | undefined {
  const entry = controller.selectedEntry.value
  return entry?.kind === 'command' ? entry.command.id : entry?.key
}

describe('command palette controller', () => {
  it('preserves a selected global command when website-only commands disappear', async () => {
    const { website, controller } = createController(true)
    await controller.openPanel()
    controller.selection.value = commandIndex(controller, 'settings')
    expect(selectedId(controller)).toBe('settings')

    website.value = false

    expect(selectedId(controller)).toBe('settings')
    expect(controller.selection.value).toBe(commandIndex(controller, 'settings'))
    controller.dispose()
  })

  it('runs the still-selected command after live website availability changes', async () => {
    const { open, website, runCommand, controller } = createController(true)
    await controller.openPanel()
    controller.selection.value = commandIndex(controller, 'settings')
    website.value = false

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledWith('settings'))

    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('reports rejected keyboard commands without leaking an unhandled rejection', async () => {
    const { open, runCommand, onRunError, controller } = createController(true)
    const failure = new Error('downloads unavailable')
    runCommand.mockRejectedValueOnce(failure)
    await controller.openPanel()
    controller.selection.value = commandIndex(controller, 'downloads')

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(onRunError).toHaveBeenCalledWith(failure, 'downloads'))

    expect(open.value).toBe(false)
    expect(runCommand).toHaveBeenCalledWith('downloads')
    controller.dispose()
  })

  it('does not run or move commands while an IME composition owns the key', async () => {
    const { open, runCommand, controller } = createController(true)
    await controller.openPanel()

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    await Promise.resolve()

    expect(controller.selection.value).toBe(0)
    expect(runCommand).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
    controller.dispose()
  })

  it('resets selection to the strongest match when the query changes', async () => {
    const { controller } = createController(true)
    await controller.openPanel()
    controller.selection.value = 5
    controller.query.value = 'visible screen'
    await nextTick()

    expect(controller.selection.value).toBe(0)
    expect(selectedId(controller)).toBe('capture-viewport')
    controller.dispose()
  })

  it('does not steal focus after it is closed while initial focus is pending', async () => {
    const { open, controller } = createController()
    const input = document.createElement('input')
    const newerTarget = document.createElement('button')
    document.body.append(input, newerTarget)
    controller.input.value = input
    const opening = controller.openPanel()
    controller.close()
    newerTarget.focus()
    await opening

    expect(open.value).toBe(false)
    expect(document.activeElement).toBe(newerTarget)
    input.remove()
    newerTarget.remove()
    controller.dispose()
  })

  it('restores input focus when a live availability change moves focus away', async () => {
    const { website, controller } = createController(true)
    const input = document.createElement('input')
    const outside = document.createElement('button')
    document.body.append(input, outside)
    controller.input.value = input
    await controller.openPanel()
    outside.focus()
    expect(document.activeElement).toBe(outside)

    website.value = false
    await nextTick()

    expect(document.activeElement).toBe(input)
    input.remove()
    outside.remove()
    controller.dispose()
  })

  it('keeps a command whose name matches above a Settings section of the same name', async () => {
    const labels: Record<string, string> = { 'commandCatalog.commands.downloads.label': 'Show downloads' }
    const search: Search = (query) => query.trim() === 'downloads'
      ? [{ id: 'settings', results: [{ kind: 'settings', id: 'downloads', label: 'Downloads', description: 'Save location', score: 40 }] }]
      : []
    const { controller } = createController(true, search, (key) => labels[key] ?? key)
    await controller.openPanel()
    controller.query.value = 'downloads'
    await nextTick()

    expect(selectedId(controller)).toBe('downloads')
    expect(controller.groups.value.map((group) => group.id)).toContain('settings')
    controller.dispose()
  })

  it('lets a result whose whole name matches outrank a command that matches only inside a word', async () => {
    const labels: Record<string, string> = { 'commandCatalog.commands.downloads.label': 'Show downloads' }
    const search: Search = (query) => query.trim() === 'ownload'
      ? [{ id: 'tabs', results: [{ kind: 'tabs', id: 'tab-1', label: 'Ownload', description: '', score: 40 }] }]
      : []
    const { controller } = createController(true, search, (key) => labels[key] ?? key)
    await controller.openPanel()
    controller.query.value = 'ownload'
    await nextTick()

    expect(selectedId(controller)).toBe('tabs:tab-1')
    expect(commandIndex(controller, 'downloads')).toBeGreaterThan(0)
    controller.dispose()
  })

  it('does not search while closed and keeps its last results through the exit', async () => {
    const search = vi.fn<Search>((query) => query.trim()
      ? [{ id: 'tabs', results: [{ kind: 'tabs', id: 'tab-1', label: 'Alpha', description: '', score: 30 }] }]
      : [])
    const { controller } = createController(true, search)
    await controller.openPanel()
    controller.query.value = 'alp'
    await nextTick()
    expect(controller.entries.value.some((entry) => entry.key === 'tabs:tab-1')).toBe(true)
    const calls = search.mock.calls.length

    controller.close()
    controller.query.value = 'alpha'
    await nextTick()

    expect(controller.entries.value.some((entry) => entry.key === 'tabs:tab-1')).toBe(true)
    expect(search.mock.calls.length).toBe(calls)
    controller.dispose()
  })

  it('leaves focus alone when a search returns the same rows again', async () => {
    let generation = 0
    const reactiveGeneration = ref(0)
    const search: Search = (query) => {
      generation = reactiveGeneration.value
      return query.trim() ? [{ id: 'tabs', results: [{ kind: 'tabs', id: 'tab-1', label: 'Alpha', description: String(generation), score: 30 }] }] : []
    }
    const { controller } = createController(true, search)
    const input = document.createElement('input')
    const outside = document.createElement('button')
    document.body.append(input, outside)
    controller.input.value = input
    await controller.openPanel()
    controller.query.value = 'alp'
    await nextTick()
    await nextTick()
    outside.focus()

    reactiveGeneration.value += 1
    await nextTick()
    await nextTick()

    expect(generation).toBe(1)
    expect(document.activeElement).toBe(outside)
    input.remove()
    outside.remove()
    controller.dispose()
  })
})
