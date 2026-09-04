<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import UiButton from './UiButton.vue'

export interface UiMenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
}

const props = withDefaults(defineProps<{
  items: UiMenuItem[]
  label: string
  open?: boolean
}>(), {
  open: false
})
const emit = defineEmits<{
  'update:open': [open: boolean]
  select: [id: string]
}>()
const menu = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const trigger = ref<InstanceType<typeof UiButton> | null>(null)

function setOpen(value: boolean): void {
  emit('update:open', value)
  if (value) void nextTick(() => focusAt(0))
}

function focusAt(index: number): void {
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length) return
  items[(index + items.length) % items.length]?.focus()
}

function move(event: KeyboardEvent, direction: number): void {
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  focusAt(current + direction)
  event.preventDefault()
}

function select(item: UiMenuItem): void {
  if (item.disabled) return
  emit('select', item.id)
  setOpen(false)
  void nextTick(() => trigger.value?.focus())
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (props.open && !root.value?.contains(event.target as Node)) setOpen(false)
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <span ref="root" class="ui-menu">
    <UiButton
      ref="trigger"
      variant="ghost"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="setOpen(!open)"
      @keydown.down.prevent="setOpen(true)"
    ><slot name="trigger">{{ label }}</slot></UiButton>
    <span
      v-if="open"
      ref="menu"
      class="ui-menu__panel"
      role="menu"
      :aria-label="label"
      @keydown.down="move($event, 1)"
      @keydown.up="move($event, -1)"
      @keydown.home.prevent="focusAt(0)"
      @keydown.end.prevent="focusAt(-1)"
      @keydown.esc.prevent="setOpen(false); trigger?.focus()"
    >
      <UiButton
        v-for="item in items"
        :key="item.id"
        role="menuitem"
        variant="ghost"
        size="small"
        :class="{ 'ui-menu__item--danger': item.danger }"
        :disabled="item.disabled"
        @click="select(item)"
      >{{ item.label }}</UiButton>
    </span>
  </span>
</template>
