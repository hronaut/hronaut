<script setup lang="ts">
defineProps<{
  label: string
  description?: string
}>()
</script>

<template>
  <div class="ui-setting-row">
    <div class="ui-setting-row__copy">
      <strong>{{ label }}</strong>
      <small v-if="description">{{ description }}</small>
    </div>
    <div class="ui-setting-row__control"><slot /></div>
  </div>
</template>
