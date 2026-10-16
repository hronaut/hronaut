<script setup lang="ts">
import UiButton from './UiButton.vue'
import { vTooltip } from './tooltip.js'

withDefaults(defineProps<{
  label: string
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost'
  size?: 'small' | 'medium' | 'large'
  disabled?: boolean
  busy?: boolean
  pressed?: boolean | null
  loadingLabel?: string
  /** Tooltip text when it differs from the accessible label. */
  tooltip?: string
}>(), {
  variant: 'ghost',
  size: 'small',
  disabled: false,
  pressed: null
})
</script>

<template>
  <UiButton
    class="ui-icon-button"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :busy="busy"
    :pressed="pressed"
    :loading-label="loadingLabel"
    :aria-label="busy && loadingLabel ? loadingLabel : label"
    v-tooltip="tooltip ?? label"
  >
    <slot />
  </UiButton>
</template>
