<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import UiOverlayTransition from "../ui/UiOverlayTransition.vue"
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardCommandKey from '~icons/material-symbols/keyboard-command-key-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconSchedule from '~icons/material-symbols/schedule-outline-rounded'
import type { HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { commandShortcutKeys, type CommandPaletteCommandId, type CommandPaletteSectionId } from '../../../shared/command-palette.js'
import { COMMAND_PALETTE_ICONS } from '../command-palette-icons.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import { useCommandPaletteController } from '../composables/useCommandPaletteController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

const props = defineProps<{
  websiteAvailable: boolean
  /** The workspace in view, whose agents' commands come first while they work there. */
  activeWorkspaceId?: string
  presenceApi?: HronautAgentPresenceApi
  formatNumber: (value: number) => string
  runCommand: (commandId: CommandPaletteCommandId) => unknown
  reportCommandError: (error: unknown, commandId: CommandPaletteCommandId) => void
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const websiteAvailable = toRef(props, 'websiteAvailable')
const presenceApi = props.presenceApi ?? (window as { hronautAgentPresence?: HronautAgentPresenceApi }).hronautAgentPresence
const presence = presenceApi ? useAgentPresence(presenceApi) : undefined
const agentActive = computed(() => Boolean(props.activeWorkspaceId && presence?.snapshot.value.workspaces[props.activeWorkspaceId]?.length))
const mac = window.hronautShell?.windowChrome.platform === 'darwin'
const paletteKeys = mac ? ['⌘', '⇧', 'P'] : ['Ctrl', 'Shift', 'P']
const SECTION_LABEL_KEYS: Record<Exclude<CommandPaletteSectionId, 'recent'>, string> = {
  agents: 'commandCatalog.categories.Agents',
  navigation: 'commandCatalog.categories.Navigation',
  website: 'commandCatalog.categories.Current website',
  application: 'commandCatalog.categories.Application'
}
function sectionLabel(id: CommandPaletteSectionId): string {
  return id === 'recent' ? t('commandPalette.recent') : t(SECTION_LABEL_KEYS[id])
}
const {
  input,
  query,
  selection,
  sections,
  commands,
  selectedCommand,
  commandElementId,
  openPanel: openControllerPanel,
  close,
  run,
  handleKeydown,
  dispose
} = useCommandPaletteController({
  open,
  websiteAvailable,
  agentActive,
  translate: (key, parameters) => t(key, parameters ?? {}),
  runCommand: props.runCommand,
  onRunError: props.reportCommandError
})

useModalDialogFocus({ open, panel, focusOnOpen: false })

const liveListPointerGuardMs = 150
let lastPointerPosition: { x: number; y: number } | null = null
let pointerSelectionBlockedUntil = 0
const stopWebsiteAvailabilityTracking = watch(websiteAvailable, () => {
  pointerSelectionBlockedUntil = Date.now() + liveListPointerGuardMs
})
const stopOpenTracking = watch(open, (isOpen) => {
  if (!isOpen) return
  lastPointerPosition = null
  pointerSelectionBlockedUntil = 0
}, { flush: 'sync' })

async function openPanel(): Promise<void> {
  lastPointerPosition = null
  pointerSelectionBlockedUntil = 0
  await openControllerPanel()
}

function selectFromPointer(event: PointerEvent, index: number): void {
  if (Date.now() < pointerSelectionBlockedUntil) return
  const position = { x: event.clientX, y: event.clientY }
  if (lastPointerPosition?.x === position.x && lastPointerPosition.y === position.y) return
  lastPointerPosition = position
  selection.value = index
}

function disposeComponent(): void {
  stopWebsiteAvailabilityTracking()
  stopOpenTracking()
  presence?.dispose()
  dispose()
}

defineExpose({ openPanel, close })
onBeforeUnmount(disposeComponent)
</script>

<template>
  <UiOverlayTransition>
    <div v-if="open" class="settings-overlay command-palette-overlay" @click.self="close">
      <section
        ref="panel"
        class="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
      >
        <header class="command-palette-header">
          <IconKeyboardCommandKey aria-hidden="true" />
          <div>
            <span class="eyebrow">{{ t('commandPalette.kicker') }}</span>
            <h2 id="command-palette-title">{{ t('commandPalette.heading') }}</h2>
          </div>
          <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('commandPalette.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
        </header>
        <div class="command-palette-field">
          <IconSearch aria-hidden="true" />
          <input
            ref="input"
            v-model="query"
            type="search"
            role="combobox"
            :aria-label="t('commandPalette.search')"
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            :aria-expanded="commands.length > 0"
            :aria-activedescendant="selectedCommand ? commandElementId(selectedCommand) : undefined"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('commandPalette.placeholder')"
            @keydown="handleKeydown"
          />
          <span class="command-palette-keys" aria-hidden="true"><kbd v-for="key in paletteKeys" :key="key">{{ key }}</kbd></span>
        </div>
        <span class="sr-only" role="status" aria-live="polite">
          {{ t('commandPalette.matches', { count: formatNumber(commands.length) }, commands.length) }}<template v-if="selectedCommand"> {{ t('commandPalette.selected', { label: selectedCommand.label }) }}</template>
        </span>
        <div v-if="commands.length" id="command-palette-results" class="command-palette-results" role="listbox" :aria-label="t('commandPalette.available')">
          <div v-for="section in sections" :key="section.id" class="command-palette-section" role="group" :aria-labelledby="`command-palette-section-${section.id}`" :data-section="section.id">
            <h3 :id="`command-palette-section-${section.id}`" class="command-palette-heading" aria-hidden="true">
              <IconSchedule v-if="section.id === 'recent'" aria-hidden="true" />{{ sectionLabel(section.id) }}
            </h3>
            <UiButton appearance="application"
              v-for="command in section.commands"
              :id="commandElementId(command)"
              :key="command.id"
              class="command-palette-item"
              :class="{ selected: command.id === selectedCommand?.id }"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="command.id === selectedCommand?.id"
              @pointermove="selectFromPointer($event, commands.indexOf(command))"
              @click="run(command.id)"
            >
              <span class="command-palette-mark" aria-hidden="true"><component :is="COMMAND_PALETTE_ICONS[command.id]" /></span>
              <span class="command-palette-copy">
                <strong>{{ command.label }}</strong>
                <small>{{ command.description }}</small>
              </span>
              <span class="command-palette-meta">
                <span v-if="command.shortcut" class="command-palette-keys"><kbd v-for="(key, keyIndex) in commandShortcutKeys(command.shortcut, mac)" :key="keyIndex">{{ key }}</kbd></span>
              </span>
            </UiButton>
          </div>
        </div>
        <div v-else class="command-palette-empty">
          <IconSearch aria-hidden="true" />
          <strong>{{ t('commandPalette.empty') }}</strong>
          <span>{{ t('commandPalette.emptyDescription') }}</span>
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> {{ t('commandPalette.navigate') }}</span><span><kbd>Enter</kbd> {{ t('commandPalette.run') }}</span><span><kbd>Esc</kbd> {{ t('common.close') }}</span></footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
