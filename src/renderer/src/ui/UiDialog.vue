<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import UiIconButton from './UiIconButton.vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  closeLabel?: string
  dismissible?: boolean
}>(), {
  closeLabel: 'Close',
  dismissible: true
})
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const panel = ref<HTMLElement | null>(null)
const titleId = `ui-dialog-title-${useId()}`
const descriptionId = `ui-dialog-description-${useId()}`
let restoreFocusTo: HTMLElement | null = null

function close(): void {
  if (props.dismissible) emit('update:open', false)
}

function focusFirst(): void {
  const focusable = panel.value?.querySelector<HTMLElement>('[autofocus], button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
  ;(focusable ?? panel.value)?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.dismissible) {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
  if (!items.length) {
    event.preventDefault()
    panel.value.focus()
    return
  }
  const first = items[0]
  const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(() => props.open, (open) => {
  if (open) {
    restoreFocusTo = document.activeElement as HTMLElement | null
    document.body.classList.add('ui-dialog-open')
    void nextTick(focusFirst)
  } else {
    document.body.classList.remove('ui-dialog-open')
    restoreFocusTo?.focus()
    restoreFocusTo = null
  }
}, { immediate: true })
onBeforeUnmount(() => document.body.classList.remove('ui-dialog-open'))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ui-dialog__backdrop" @mousedown.self="close">
      <section
        ref="panel"
        class="ui-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="description ? descriptionId : undefined"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header class="ui-dialog__header">
          <div><h2 :id="titleId">{{ title }}</h2><p v-if="description" :id="descriptionId">{{ description }}</p></div>
          <UiIconButton v-if="dismissible" :label="closeLabel" @click="close">×</UiIconButton>
        </header>
        <div class="ui-dialog__body"><slot /></div>
        <footer v-if="$slots.footer" class="ui-dialog__footer"><slot name="footer" :close="close" /></footer>
      </section>
    </div>
  </Teleport>
</template>
