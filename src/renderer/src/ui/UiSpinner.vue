<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  size?: 'small' | 'medium' | 'large'
}>(), {
  label: 'Loading',
  size: 'medium'
})
</script>

<template>
  <span class="ui-spinner" :class="`ui-spinner--${size}`" role="status">
    <span class="ui-spinner__ring" aria-hidden="true" />
    <span class="ui-visually-hidden">{{ label }}</span>
  </span>
</template>
