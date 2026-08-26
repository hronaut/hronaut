<script setup lang="ts">
import type { PanelDock } from '../../../shared/types'

defineProps<{
  dock: PanelDock
  active: boolean
  minimum: number
  maximum: number
  value: number
  label: string
  title: string
}>()

const emit = defineEmits<{
  pointerdown: [event: PointerEvent]
  keydown: [event: KeyboardEvent]
  reset: []
}>()
</script>

<template>
  <div
    class="panel-resize-handle"
    :class="{ active }"
    role="separator"
    :aria-orientation="dock === 'right' || dock === 'left' ? 'vertical' : 'horizontal'"
    :aria-label="label"
    :aria-valuemin="minimum"
    :aria-valuemax="maximum"
    :aria-valuenow="value"
    tabindex="0"
    :title="title"
    @pointerdown="emit('pointerdown', $event)"
    @keydown="emit('keydown', $event)"
    @dblclick="emit('reset')"
  />
</template>
