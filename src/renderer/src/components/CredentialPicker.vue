<script setup lang="ts">
import { onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardArrowRight from '~icons/material-symbols/keyboard-arrow-right-rounded'
import IconKey from '~icons/material-symbols/key-rounded'
import IconPassword from '~icons/material-symbols/password-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconShieldLock from '~icons/material-symbols/shield-lock-rounded'
import type { CredentialSummary } from '../../../shared/types.js'
import { useCredentialPickerController } from '../composables/useCredentialPickerController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

const props = defineProps<{
  credentials: CredentialSummary[]
  origin: string | null
  fillCredential: (credential: CredentialSummary) => unknown
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const {
  input,
  query,
  selection,
  credentials,
  credentialIds,
  selectedCredential,
  credentialOptionId,
  openPanel: openControllerPanel,
  close,
  fill,
  handleKeydown,
  dispose
} = useCredentialPickerController({
  open,
  credentials: toRef(props, 'credentials'),
  origin: toRef(props, 'origin'),
  translate: (key) => t(key),
  fillCredential: props.fillCredential
})

useModalDialogFocus({ open, panel, focusOnOpen: false })

const liveListPointerGuardMs = 150
let lastPointerPosition: { x: number; y: number } | null = null
let pointerSelectionBlockedUntil = 0
const stopCredentialIdTracking = watch(credentialIds, () => {
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
  stopCredentialIdTracking()
  stopOpenTracking()
  dispose()
}

defineExpose({ openPanel, close })
onBeforeUnmount(disposeComponent)
</script>

<template>
  <div v-if="open" class="settings-overlay credential-picker-overlay" @click.self="close">
    <section ref="panel" class="credential-picker" role="dialog" aria-modal="true" aria-labelledby="credential-picker-title">
      <header class="credential-picker-header">
        <IconPassword aria-hidden="true" />
        <div>
          <span class="eyebrow">{{ t('credentialPicker.kicker') }}</span>
          <h2 id="credential-picker-title">{{ t('credentialPicker.heading') }}</h2>
        </div>
        <button class="panel-close" type="button" :aria-label="t('credentialPicker.close')" @click="close"><IconClose aria-hidden="true" /></button>
      </header>
      <div class="credential-picker-field">
        <IconSearch aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          type="search"
          role="combobox"
          :aria-label="t('credentialPicker.search')"
          aria-autocomplete="list"
          aria-controls="credential-picker-results"
          :aria-expanded="credentials.length > 0"
          :aria-activedescendant="selectedCredential ? credentialOptionId(selectedCredential) : undefined"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('credentialPicker.placeholder')"
          @keydown="handleKeydown"
        />
      </div>
      <div v-if="credentials.length" id="credential-picker-results" class="credential-picker-results" role="listbox" :aria-label="t('credentialPicker.results')">
        <button
          v-for="(credential, index) in credentials"
          :id="credentialOptionId(credential)"
          :key="credential.id"
          class="credential-picker-item"
          :class="{ selected: index === selection }"
          type="button"
          role="option"
          :aria-selected="index === selection"
          @pointermove="selectFromPointer($event, index)"
          @click="fill(credential)"
        >
          <span class="credential-picker-mark" aria-hidden="true"><IconKey /></span>
          <span><strong>{{ credential.username || t('credentialPicker.unnamed') }}</strong><small>{{ credential.origin }}</small></span>
          <IconKeyboardArrowRight aria-hidden="true" />
        </button>
      </div>
      <div v-else class="credential-picker-empty"><IconSearch aria-hidden="true" /><strong>{{ t('credentialPicker.empty') }}</strong><span>{{ t('credentialPicker.tryAnother') }}</span></div>
      <footer><span><IconShieldLock aria-hidden="true" /> {{ t('credentialPicker.paused') }}</span><span><kbd>↑</kbd><kbd>↓</kbd> {{ t('credentialPicker.select') }} · <kbd>Enter</kbd> {{ t('credentialPicker.fill') }}</span></footer>
    </section>
  </div>
</template>
