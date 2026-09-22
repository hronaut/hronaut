import { computed, nextTick, ref, watch, type Ref } from 'vue'
import {
  COMMAND_PALETTE_COMMANDS,
  filterCommandPaletteCommands,
  type CommandPaletteCommand,
  type CommandPaletteCommandId
} from '../../../shared/command-palette.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface CommandPaletteControllerOptions {
  open: Ref<boolean>
  websiteAvailable: Readonly<Ref<boolean>>
  translate: Translate
  runCommand: (commandId: CommandPaletteCommandId) => unknown
  onRunError: (error: unknown, commandId: CommandPaletteCommandId) => void
}

export function useCommandPaletteController(options: CommandPaletteControllerOptions) {
  const input = ref<HTMLInputElement | null>(null)
  const query = ref('')
  const selection = ref(0)
  const localizedCommands = computed<CommandPaletteCommand[]>(() => COMMAND_PALETTE_COMMANDS.map((command) => ({
    ...command,
    label: options.translate(`commandCatalog.commands.${command.id}.label`),
    description: options.translate(`commandCatalog.commands.${command.id}.description`),
    category: options.translate(`commandCatalog.categories.${command.category}`) as CommandPaletteCommand['category']
  })))
  const commands = computed(() => filterCommandPaletteCommands(
    query.value,
    options.websiteAvailable.value,
    localizedCommands.value
  ))
  const commandIds = computed(() => commands.value.map((command) => command.id))
  const selectedCommand = computed(() => commands.value[selection.value])
  let presentationGeneration = 0

  function commandElementId(command: CommandPaletteCommand): string {
    return `command-palette-${command.id}`
  }

  function revealSelectedCommand(): void {
    const command = selectedCommand.value
    if (!command) return
    document.getElementById(commandElementId(command))?.scrollIntoView?.({ block: 'nearest' })
  }

  function restoreFocusAndReveal(): void {
    if (options.open.value) input.value?.focus({ preventScroll: true })
    revealSelectedCommand()
  }

  async function focusAndReveal(generation: number): Promise<boolean> {
    await nextTick()
    if (generation !== presentationGeneration || !options.open.value) return false
    input.value?.focus()
    revealSelectedCommand()
    return true
  }

  async function openPanel(): Promise<void> {
    presentationGeneration += 1
    query.value = ''
    selection.value = 0
    options.open.value = true
    const generation = presentationGeneration
    if (await focusAndReveal(generation)) input.value?.select()
  }

  function close(): void {
    options.open.value = false
  }

  async function run(commandId: CommandPaletteCommandId): Promise<void> {
    close()
    try {
      await options.runCommand(commandId)
    } catch (error) {
      options.onRunError(error, commandId)
    }
  }

  async function runSelectedCommand(): Promise<void> {
    if (selectedCommand.value) await run(selectedCommand.value.id)
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    if (!commands.value.length) return
    selection.value = (selection.value + offset + commands.value.length) % commands.value.length
    await nextTick()
    revealSelectedCommand()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      void moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(-1)
      return
    }
    if (event.key === 'Enter' && selectedCommand.value) {
      event.preventDefault()
      void runSelectedCommand()
    }
  }

  const stopCommandTracking = watch(
    [query, commandIds],
    ([nextQuery, nextIds], [previousQuery, previousIds]) => {
      if (nextQuery !== previousQuery) {
        selection.value = 0
      } else {
        const previousId = previousIds[selection.value]
        const preservedIndex = previousId ? nextIds.indexOf(previousId) : -1
        selection.value = preservedIndex >= 0
          ? preservedIndex
          : Math.min(selection.value, Math.max(0, nextIds.length - 1))
      }
      void nextTick().then(restoreFocusAndReveal)
    },
    { flush: 'sync' }
  )
  const stopOpenTracking = watch(options.open, (isOpen) => {
    if (!isOpen) presentationGeneration += 1
  }, { flush: 'sync' })

  function dispose(): void {
    presentationGeneration += 1
    stopCommandTracking()
    stopOpenTracking()
  }

  return {
    input,
    query,
    selection,
    commands,
    selectedCommand,
    commandElementId,
    openPanel,
    close,
    run,
    moveSelection,
    handleKeydown,
    dispose
  }
}
