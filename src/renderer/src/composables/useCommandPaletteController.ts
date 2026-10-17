import { computed, nextTick, ref, watch, type Ref } from 'vue'
import {
  COMMAND_PALETTE_COMMANDS,
  COMMAND_PALETTE_RECENT_LIMIT,
  commandPaletteSections,
  labelMatchScore,
  type CommandPaletteCommand,
  type CommandPaletteCommandId,
  type CommandPaletteSectionId
} from '../../../shared/command-palette.js'
import {
  DETAIL_MATCH_SCORE,
  type CommandPaletteResult,
  type CommandPaletteResultKind,
  type CommandPaletteResultSection
} from '../../../shared/command-palette-search.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import { readLocalPreference, writeLocalPreference, type LocalPreferenceStorageProvider } from '../local-preferences.js'

/** Where the palette remembers the commands run lately, for this window's profile only. */
export const RECENT_COMMANDS_KEY = 'hronaut:command-palette-recent'
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

/** One row of the palette: a command, or a tab, workspace, settings section or visited page it found. */
export type CommandPaletteEntry =
  | { kind: 'command'; key: string; command: CommandPaletteCommand }
  | { kind: 'result'; key: string; result: CommandPaletteResult }

export interface CommandPaletteGroup {
  id: CommandPaletteSectionId | CommandPaletteResultKind
  entries: CommandPaletteEntry[]
}

/**
 * Commands outrank what the search finds by this much, so a command keeps first place unless a tab, workspace,
 * setting or page matches by name clearly better, such as its whole name against a word inside a command's.
 */
const COMMAND_RANK_BONUS = 10

export interface CommandPaletteControllerOptions {
  open: Ref<boolean>
  websiteAvailable: Readonly<Ref<boolean>>
  /** An agent works in the workspace in view. */
  agentActive?: Readonly<Ref<boolean>>
  /** An agent is working on the tab in view, and the person can take it over. */
  takeOverAvailable?: Readonly<Ref<boolean>>
  storage?: LocalPreferenceStorageProvider
  translate: Translate
  runCommand: (commandId: CommandPaletteCommandId) => unknown
  onRunError: (error: unknown, commandId: CommandPaletteCommandId) => void
  /** Tabs, workspaces, settings and visited pages matching a search; nothing is searched until something is typed. */
  search?: (query: string) => readonly CommandPaletteResultSection[]
  /** Goes to a search result; it reports its own failures. */
  openResult?: (result: CommandPaletteResult) => unknown
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
    takeOverAvailable: options.takeOverAvailable?.value ?? false,
    recentIds: recentIds.value
  }, localizedCommands.value))
  const commands = computed(() => sections.value.flatMap((section) => section.commands))
  const resultSections = computed(() => query.value.trim() && options.search ? options.search(query.value) : [])
  // One list: the best match first, commands ahead of results that match as well.
  const groups = computed<CommandPaletteGroup[]>(() => {
    const searching = Boolean(query.value.trim())
    const ranked = [
      ...sections.value.map((section) => ({
        id: section.id,
        rank: searching
          ? COMMAND_RANK_BONUS + Math.max(DETAIL_MATCH_SCORE, ...section.commands.map((command) => labelMatchScore(command.label, query.value)))
          : 0,
        entries: section.commands.map((command): CommandPaletteEntry => ({ kind: 'command', key: `command:${command.id}`, command }))
      })),
      ...resultSections.value.filter((section) => section.results.length).map((section) => ({
        id: section.id,
        rank: Math.max(...section.results.map((result) => result.score)),
        entries: section.results.map((result): CommandPaletteEntry => ({ kind: 'result', key: `${result.kind}:${result.id}`, result }))
      }))
    ]
    return ranked
      .map((group, index) => ({ group, index }))
      .sort((left, right) => right.group.rank - left.group.rank || left.index - right.index)
      .map(({ group }) => ({ id: group.id, entries: group.entries }))
  })
  const entries = computed(() => groups.value.flatMap((group) => group.entries))
  const entryKeys = computed(() => entries.value.map((entry) => entry.key))
  const selectedEntry = computed<CommandPaletteEntry | undefined>(() => entries.value[selection.value])
  const selectedCommand = computed(() => selectedEntry.value?.kind === 'command' ? selectedEntry.value.command : undefined)
  let presentationGeneration = 0

  function commandElementId(command: CommandPaletteCommand): string {
    return `command-palette-${command.id}`
  }

  function entryElementId(entry: CommandPaletteEntry): string {
    if (entry.kind === 'command') return commandElementId(entry.command)
    return `command-palette-${entry.result.kind}-${entry.result.id.replace(/[^\w-]/gu, '-')}`
  }

  function revealSelectedCommand(): void {
    const entry = selectedEntry.value
    if (!entry) return
    document.getElementById(entryElementId(entry))?.scrollIntoView?.({ block: 'nearest' })
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

  async function runEntry(entry: CommandPaletteEntry): Promise<void> {
    if (entry.kind === 'command') {
      await run(entry.command.id)
      return
    }
    close()
    await options.openResult?.(entry.result)
  }

  async function runSelectedEntry(): Promise<void> {
    if (selectedEntry.value) await runEntry(selectedEntry.value)
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    if (!entries.value.length) return
    selection.value = (selection.value + offset + entries.value.length) % entries.value.length
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
    if (event.key === 'Enter' && selectedEntry.value) {
      event.preventDefault()
      void runSelectedEntry()
    }
  }

  const stopCommandTracking = watch(
    [query, entryKeys],
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
    groups,
    entries,
    selectedEntry,
    selectedCommand,
    commandElementId,
    entryElementId,
    openPanel,
    close,
    run,
    runEntry,
    moveSelection,
    handleKeydown,
    dispose
  }
}
