<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  description?: string
  forId?: string
  disabled?: boolean
  stacked?: boolean
  group?: boolean
}>(), {
  disabled: false,
  stacked: false,
  group: false
})
</script>

<template>
  <div
    class="ui-setting-row"
    :class="{ 'ui-setting-row--disabled': disabled, 'ui-setting-row--stacked': stacked }"
    :role="group ? 'group' : undefined"
    :aria-disabled="disabled || undefined"
  >
    <div class="ui-setting-row__copy">
      <label v-if="forId" class="ui-setting-row__label" :for="forId">{{ label }}</label>
      <strong v-else>{{ label }}</strong>
      <small v-if="description">{{ description }}</small>
    </div>
    <div class="ui-setting-row__control"><slot /></div>
  </div>
</template>
