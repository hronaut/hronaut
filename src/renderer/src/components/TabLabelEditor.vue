<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MAX_TAB_LABEL_INPUT_LENGTH, normalizeTabLabel } from '../../../shared/tab-label.js'
import type { BrowserTabState } from '../../../shared/types.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{ tab: BrowserTabState }>()
const { t } = useI18n({ useScope: 'global' })
const editing = ref(false)
const draft = ref('')
const pending = ref(false)
const error = ref('')
const root = ref<HTMLDivElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const trigger = ref<{ focus: () => void } | null>(null)
let generation = 0
let stopTrackingFocus: (() => void) | undefined
onBeforeUnmount(() => { generation += 1; stopTrackingFocus?.() })

async function edit(): Promise<void> {
  const token = ++generation
  draft.value = props.tab.label ?? ''
  error.value = ''
  editing.value = true
  await nextTick()
  if (token === generation && editing.value) {
    input.value?.focus({ preventScroll: true })
    input.value?.closest('form')?.scrollIntoView?.({ block: 'nearest' })
  }
}
async function close(restoreFocus: () => boolean): Promise<void> {
  const token = ++generation
  editing.value = false
  error.value = ''
  await nextTick()
  if (token === generation && restoreFocus()) trigger.value?.focus()
}
async function cancel(): Promise<void> {
  await close(() => true)
}
async function save(clear = false): Promise<void> {
  if (pending.value) return
  try { normalizeTabLabel(clear ? '' : draft.value) } catch {
    error.value = t('tabLabel.invalid')
    return
  }
  const token = generation
  const tabId = props.tab.id
  // Disabling the saving control can move focus to body without a focusin.
  // Remember the latest explicit owner so leaving for search and then body
  // never lets an old completion reclaim focus.
  let ownsFocus = root.value?.contains(document.activeElement) ?? false
  const trackFocus = (event: FocusEvent): void => {
    ownsFocus = event.target instanceof Node && (root.value?.contains(event.target) ?? false)
  }
  const retainsFocus = (): boolean => ownsFocus &&
    (document.activeElement === document.body || (root.value?.contains(document.activeElement) ?? false))
  document.addEventListener('focusin', trackFocus)
  stopTrackingFocus = () => document.removeEventListener('focusin', trackFocus)
  pending.value = true
  error.value = ''
  try {
    const result = await window.hronaut.setTabLabel(tabId, clear ? '' : draft.value)
    // Browser state comes from main's ordered broadcasts. Never replay a
    // possibly stale IPC response over a later navigation or label edit.
    if (token !== generation || props.tab.id !== tabId) return
    if (result.status === 'durability-unconfirmed') {
      error.value = t('tabLabel.uncertain')
    } else {
      const restoreFocus = retainsFocus()
      pending.value = false
      await close(() => restoreFocus && retainsFocus())
    }
  } catch {
    if (token === generation && props.tab.id === tabId) error.value = t('tabLabel.failed')
  } finally {
    stopTrackingFocus?.()
    stopTrackingFocus = undefined
    pending.value = false
  }
}
</script>

<template>
  <div ref="root" class="tab-label-editor" @keydown.stop>
    <p v-if="tab.labelDurabilityUnconfirmed && !editing" role="alert">{{ t('tabLabel.uncertain') }}</p>
    <UiButton v-if="!editing" ref="trigger" size="small" :disabled="pending" :aria-label="t('tabLabel.editAria', { title: tab.label || tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) })" @click="edit">{{ t('tabLabel.edit') }}</UiButton>
    <form v-else :aria-label="t('tabLabel.edit')" @submit.prevent="save()" @keydown.esc.stop.prevent="cancel">
      <label :for="`tab-label-${tab.id}`">{{ t('tabLabel.name') }}</label>
      <input class="ui-control ui-input" :id="`tab-label-${tab.id}`" ref="input" v-model="draft" :maxlength="MAX_TAB_LABEL_INPUT_LENGTH" :disabled="pending" :aria-describedby="`tab-label-help-${tab.id}`" autocomplete="off" />
      <small :id="`tab-label-help-${tab.id}`">{{ t('tabLabel.help') }}</small>
      <p v-if="error" role="alert">{{ error }}</p>
      <div>
        <UiButton type="submit" size="small" :busy="pending">{{ t('tabLabel.save') }}</UiButton>
        <UiButton size="small" :disabled="pending || !tab.label" @click="save(true)">{{ t('tabLabel.clear') }}</UiButton>
        <UiButton size="small" @click="cancel">{{ t('tabLabel.cancel') }}</UiButton>
      </div>
    </form>
  </div>
</template>
