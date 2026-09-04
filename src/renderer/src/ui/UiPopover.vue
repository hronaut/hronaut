<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import UiButton from './UiButton.vue'

const props = withDefaults(defineProps<{
  label: string
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
  disabled?: boolean
}>(), {
  placement: 'bottom-start',
  disabled: false
})
const open = defineModel<boolean>({ default: false })
const root = ref<HTMLElement | null>(null)
const trigger = ref<InstanceType<typeof UiButton> | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = `ui-popover-${useId()}`

function close({ restoreFocus = false } = {}): void {
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function toggle(): void {
  if (!props.disabled) open.value = !open.value
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (open.value && !root.value?.contains(event.target as Node)) close()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close({ restoreFocus: true })
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
watch(open, (value) => {
  if (value) void nextTick(() => panel.value?.querySelector<HTMLElement>('[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus())
})

defineExpose({ close, focus: () => trigger.value?.focus() })
</script>

<template>
  <span ref="root" class="ui-popover" :class="`ui-popover--${placement}`">
    <UiButton
      ref="trigger"
      class="ui-popover__trigger"
      variant="ghost"
      :disabled="disabled"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="toggle"
    ><slot name="trigger" :open="open" /></UiButton>
    <span v-if="open" :id="panelId" ref="panel" class="ui-popover__panel"><slot :close="close" /></span>
  </span>
</template>
