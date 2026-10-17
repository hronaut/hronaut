<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { beginSurfaceLeave } from '../composables/overlay-motion.js'
import UiButton from './UiButton.vue'
import { vTooltip } from './tooltip.js'

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
  /** The panel's edge lined up with the trigger's; end keeps a menu at a right edge inside its container. */
  align?: 'start' | 'end'
  triggerId?: string
  /** A themed tooltip for an icon-only trigger. */
  tooltip?: string
}>(), {
  open: false,
  align: 'start',
  triggerId: undefined,
  tooltip: undefined
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

/** Esc closes an open menu, from the trigger as well as its items, and goes no further. */
function onEscape(event: KeyboardEvent): void {
  if (!props.open) return
  event.preventDefault()
  setOpen(false)
  trigger.value?.focus()
}

/** Tabbing away closes the menu; a click elsewhere is left to the pointer handler. */
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget
  if (props.open && next instanceof Node && !root.value?.contains(next)) setOpen(false)
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <span ref="root" :class="['ui-menu', `ui-menu--${align}`]" @focusout="onFocusOut" @keydown.esc="onEscape">
    <UiButton
      :id="triggerId"
      ref="trigger"
      v-tooltip="open ? undefined : tooltip"
      variant="ghost"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="setOpen(!open)"
      @keydown.down.prevent="setOpen(true)"
    ><slot name="trigger">{{ label }}</slot></UiButton>
    <Transition name="ui-surface" @before-leave="beginSurfaceLeave">
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
    </Transition>
  </span>
</template>
