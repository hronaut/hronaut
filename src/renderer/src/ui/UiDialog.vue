<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import UiIconButton from './UiIconButton.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  closeLabel?: string
  dismissible?: boolean
  /** Whether a press on the backdrop closes a dismissible dialog; a question that must be answered keeps it off. */
  closeOnBackdrop?: boolean
  /** `alertdialog` for a question that interrupts the person, such as a permission request. */
  role?: 'dialog' | 'alertdialog'
}>(), {
  closeLabel: 'Close',
  dismissible: true,
  closeOnBackdrop: true,
  role: 'dialog'
})
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const panel = ref<HTMLElement | null>(null)
const titleId = `ui-dialog-title-${useId()}`
const descriptionId = `ui-dialog-description-${useId()}`
let restoreFocusTo: HTMLElement | null = null

function close(): void {
  if (props.dismissible) emit('update:open', false)
}

function closeFromBackdrop(): void {
  if (props.closeOnBackdrop) close()
}

function focusFirst(): void {
  // A control marked autofocus wins over the close button before it, such as a question's safe answer.
  const focusable = panel.value?.querySelector<HTMLElement>('[autofocus]')
    ?? panel.value?.querySelector<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
  ;(focusable ?? panel.value)?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.dismissible) {
    event.preventDefault()
    // A held Escape repeats; only its first press closes, so a key held from before the dialog opened does not.
    if (!event.repeat) close()
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
    <div v-if="open" class="ui-dialog__backdrop" @mousedown.self="closeFromBackdrop">
      <section
        v-bind="$attrs"
        ref="panel"
        class="ui-dialog"
        :role="role"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="description ? descriptionId : undefined"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header class="ui-dialog__header">
          <span v-if="$slots.icon" class="ui-dialog__icon" aria-hidden="true"><slot name="icon" /></span>
          <div class="ui-dialog__heading">
            <slot name="eyebrow" />
            <h2 :id="titleId"><slot name="title">{{ title }}</slot></h2>
            <p v-if="description" :id="descriptionId">{{ description }}</p>
          </div>
          <UiIconButton v-if="dismissible" :label="closeLabel" @click="close">×</UiIconButton>
        </header>
        <div v-if="$slots.default" class="ui-dialog__body"><slot /></div>
        <footer v-if="$slots.footer" class="ui-dialog__footer"><slot name="footer" :close="close" /></footer>
      </section>
    </div>
  </Teleport>
</template>
