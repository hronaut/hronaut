<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  live?: 'off' | 'polite' | 'assertive'
}>(), {
  tone: 'neutral',
  live: 'off'
})
</script>

<template>
  <div
    class="ui-notice"
    :class="`ui-notice--${tone}`"
    :role="tone === 'danger' ? 'alert' : undefined"
    :aria-live="live === 'off' ? undefined : live"
  >
    <slot />
  </div>
</template>
