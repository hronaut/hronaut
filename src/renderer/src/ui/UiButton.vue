<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost'
  size?: 'small' | 'medium' | 'large'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  busy?: boolean
  native?: boolean
}>(), {
  variant: 'secondary',
  size: 'medium',
  type: 'button',
  disabled: false,
  busy: false,
  native: false
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
    :class="props.native ? undefined : ['ui-button', `ui-button--${props.variant}`, `ui-button--${props.size}`]"
    :type="props.type"
    :disabled="props.disabled || props.busy"
    :aria-busy="props.busy || undefined"
  >
    <slot />
  </button>
</template>
