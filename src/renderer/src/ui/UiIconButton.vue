<script setup lang="ts">
import UiButton from './UiButton.vue'

withDefaults(defineProps<{
  label: string
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
}>(), {
  variant: 'ghost',
  disabled: false
})
</script>

<template>
  <UiButton class="ui-icon-button" :variant="variant" size="small" :disabled="disabled" :aria-label="label" :title="label">
    <slot />
  </UiButton>
</template>
