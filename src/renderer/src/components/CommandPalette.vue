<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardCommandKey from '~icons/material-symbols/keyboard-command-key-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import type { CommandPaletteCommandId } from '../../../shared/command-palette.js'
import { useCommandPaletteController } from '../composables/useCommandPaletteController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

const props = defineProps<{
  websiteAvailable: boolean
  formatNumber: (value: number) => string
  runCommand: (commandId: CommandPaletteCommandId) => unknown
  reportCommandError: (error: unknown, commandId: CommandPaletteCommandId) => void
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const websiteAvailable = toRef(props, 'websiteAvailable')
const {
  input,
  query,
  selection,
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
  dispose()
}

defineExpose({ openPanel, close })
onBeforeUnmount(disposeComponent)
</script>

<template>
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
        <UiButton native class="panel-close" type="button" :aria-label="t('commandPalette.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
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
        <kbd>⌃/⌘ ⇧ P</kbd>
      </div>
      <span class="sr-only" role="status" aria-live="polite">
        {{ t('commandPalette.matches', { count: formatNumber(commands.length) }, commands.length) }}<template v-if="selectedCommand"> {{ t('commandPalette.selected', { label: selectedCommand.label }) }}</template>
      </span>
      <div v-if="commands.length" id="command-palette-results" class="command-palette-results" role="listbox" :aria-label="t('commandPalette.available')">
        <UiButton native
          v-for="(command, index) in commands"
          :id="commandElementId(command)"
          :key="command.id"
          class="command-palette-item"
          :class="{ selected: index === selection }"
          type="button"
          role="option"
          :aria-selected="index === selection"
          @pointermove="selectFromPointer($event, index)"
          @click="run(command.id)"
        >
          <span class="command-palette-mark" aria-hidden="true">›</span>
          <span class="command-palette-copy">
            <strong>{{ command.label }}</strong>
            <small>{{ command.description }}</small>
          </span>
          <span class="command-palette-meta">
            <kbd v-if="command.shortcut">{{ command.shortcut }}</kbd>
            <small>{{ command.category }}</small>
          </span>
        </UiButton>
      </div>
      <div v-else class="command-palette-empty">
        <IconSearch aria-hidden="true" />
        <strong>{{ t('commandPalette.empty') }}</strong>
        <span>{{ t('commandPalette.emptyDescription') }}</span>
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> {{ t('commandPalette.navigate') }}</span><span><kbd>Enter</kbd> {{ t('commandPalette.run') }}</span><span><kbd>Esc</kbd> {{ t('common.close') }}</span></footer>
    </section>
  </div>
</template>
