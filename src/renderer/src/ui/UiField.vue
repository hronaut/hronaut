<script setup lang="ts">
defineProps<{
  label: string
  forId: string
  hint?: string
  error?: string
}>()
</script>

<template>
  <div class="ui-field">
    <label class="ui-field__label" :for="forId">{{ label }}</label>
    <slot />
    <p v-if="error" class="ui-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>
