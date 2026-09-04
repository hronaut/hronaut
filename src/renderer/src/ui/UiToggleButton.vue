<script setup lang="ts">
import UiButton from './UiButton.vue'

withDefaults(defineProps<{
  pressed: boolean
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost'
  size?: 'small' | 'medium' | 'large'
  disabled?: boolean
}>(), {
  variant: 'secondary',
  size: 'medium',
  disabled: false
})
const emit = defineEmits<{ change: [pressed: boolean] }>()
</script>

<template>
  <UiButton
    :variant="variant"
    :size="size"
    :disabled="disabled"
    :pressed="pressed"
    @click="emit('change', !pressed)"
  ><slot /></UiButton>
</template>
