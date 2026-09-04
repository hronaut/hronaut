<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="ui-empty-state">
    <div v-if="$slots.icon" class="ui-empty-state__icon" aria-hidden="true"><slot name="icon" /></div>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.actions" class="ui-empty-state__actions"><slot name="actions" /></div>
  </section>
</template>
