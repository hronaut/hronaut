<script setup lang="ts">
import { nextTick, ref } from 'vue'
import UiButton from './UiButton.vue'

export interface UiSegmentedOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  options: UiSegmentedOption[]
  label: string
  disabled?: boolean
}>(), {
  disabled: false
})
const model = defineModel<string>({ required: true })
const root = ref<HTMLElement | null>(null)

function move(event: KeyboardEvent, direction: number): void {
  const enabled = props.options.filter((option) => !props.disabled && !option.disabled)
  if (!enabled.length) return
  const current = Math.max(0, enabled.findIndex((option) => option.value === model.value))
  const option = enabled[(current + direction + enabled.length) % enabled.length]
  model.value = option.value
  void nextTick(() => {
    const controls = [...(root.value?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])]
    controls.find((control) => control.dataset.value === option.value)?.focus()
  })
  event.preventDefault()
}
</script>

<template>
  <div ref="root" class="ui-segmented" role="radiogroup" :aria-label="label" :aria-disabled="disabled || undefined" @keydown.left="move($event, -1)" @keydown.right="move($event, 1)">
    <UiButton
      v-for="option in options"
      :key="option.value"
      class="ui-segmented__option"
      :class="{ 'ui-segmented__option--selected': model === option.value }"
      variant="ghost"
      role="radio"
      :data-value="option.value"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      :disabled="disabled || option.disabled"
      @click="model = option.value"
    >{{ option.label }}</UiButton>
  </div>
</template>
