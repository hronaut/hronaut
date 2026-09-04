<script setup lang="ts">
import { ref } from 'vue'
import UiSpinner from './UiSpinner.vue'

const props = withDefaults(defineProps<{
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost'
  size?: 'small' | 'medium' | 'large'
  appearance?: 'standard' | 'application'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  busy?: boolean
  pressed?: boolean | null
  loadingLabel?: string
}>(), {
  variant: 'secondary',
  size: 'medium',
  appearance: 'standard',
  type: 'button',
  disabled: false,
  busy: false,
  pressed: null
})

const element = ref<HTMLButtonElement | null>(null)

defineExpose({
  click: () => element.value?.click(),
  focus: (options?: Parameters<HTMLButtonElement['focus']>[0]) => element.value?.focus(options)
})
</script>

<template>
  <button
    ref="element"
    :class="['ui-button', `ui-button--${props.variant}`, `ui-button--${props.size}`, `ui-button--${props.appearance}`]"
    :type="props.type"
    :disabled="props.disabled || props.busy"
    :aria-busy="props.busy || undefined"
    :aria-pressed="props.pressed ?? undefined"
  >
    <UiSpinner v-if="props.busy" size="small" aria-hidden="true" />
    <span v-if="$slots.startIcon && !props.busy" class="ui-button__icon" aria-hidden="true"><slot name="startIcon" /></span>
    <template v-if="props.busy && props.loadingLabel">{{ props.loadingLabel }}</template><slot v-else />
    <span v-if="$slots.endIcon" class="ui-button__icon" aria-hidden="true"><slot name="endIcon" /></span>
  </button>
</template>
