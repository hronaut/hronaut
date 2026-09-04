<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  live?: 'off' | 'polite' | 'assertive'
  role?: 'alert' | 'status' | 'note' | 'none'
}>(), {
  tone: 'neutral',
  live: 'off',
  role: 'none'
})
</script>

<template>
  <div
    class="ui-notice"
    :class="`ui-notice--${tone}`"
    :role="role === 'none' ? undefined : role"
    :aria-live="live === 'off' ? undefined : live"
  >
    <slot />
  </div>
</template>
