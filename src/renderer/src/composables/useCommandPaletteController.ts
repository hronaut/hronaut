import { computed, nextTick, ref, watch, type Ref } from 'vue'
import {
  COMMAND_PALETTE_COMMANDS,
  COMMAND_PALETTE_RECENT_LIMIT,
  commandPaletteSections,
  type CommandPaletteCommand,
  type CommandPaletteCommandId
} from '../../../shared/command-palette.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import { readLocalPreference, writeLocalPreference, type LocalPreferenceStorageProvider } from '../local-preferences.js'

/** Where the palette remembers the commands run lately, for this window's profile only. */
export const RECENT_COMMANDS_KEY = 'hronaut.commandPalette.recent'
const COMMAND_IDS = new Set<string>(COMMAND_PALETTE_COMMANDS.map((command) => command.id))

function readRecentCommands(storage?: LocalPreferenceStorageProvider): CommandPaletteCommandId[] {
  try {
    const parsed = JSON.parse(readLocalPreference(RECENT_COMMANDS_KEY, storage) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is CommandPaletteCommandId => typeof id === 'string' && COMMAND_IDS.has(id)))].slice(0, COMMAND_PALETTE_RECENT_LIMIT)
  } catch {
    return []
  }
}

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface CommandPaletteControllerOptions {
  open: Ref<boolean>
  websiteAvailable: Readonly<Ref<boolean>>
  /** An agent works in the workspace in view. */
  agentActive?: Readonly<Ref<boolean>>
  storage?: LocalPreferenceStorageProvider
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
  // Read when the palette opens, so the list does not change under the selection while it is open.
  const recentIds = ref<CommandPaletteCommandId[]>(readRecentCommands(options.storage))
  const sections = computed(() => commandPaletteSections(query.value, {
    websiteAvailable: options.websiteAvailable.value,
    agentActive: options.agentActive?.value ?? false,
    recentIds: recentIds.value
  }, localizedCommands.value))
  const commands = computed(() => sections.value.flatMap((section) => section.commands))
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
    recentIds.value = readRecentCommands(options.storage)
    query.value = ''
    selection.value = 0
    options.open.value = true
    const generation = presentationGeneration
    if (await focusAndReveal(generation)) input.value?.select()
  }

  function close(): void {
    options.open.value = false
  }

  function rememberCommand(commandId: CommandPaletteCommandId): void {
    const next = [commandId, ...readRecentCommands(options.storage).filter((id) => id !== commandId)].slice(0, COMMAND_PALETTE_RECENT_LIMIT)
    writeLocalPreference(RECENT_COMMANDS_KEY, JSON.stringify(next), options.storage)
  }

  async function run(commandId: CommandPaletteCommandId): Promise<void> {
    close()
    rememberCommand(commandId)
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
    sections,
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
