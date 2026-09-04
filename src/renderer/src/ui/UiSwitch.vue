<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  description?: string
  disabled?: boolean
}>(), {
  disabled: false
})
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <label class="ui-switch" :class="{ 'ui-switch--disabled': disabled }">
    <span class="ui-switch__copy"><strong>{{ label }}</strong><small v-if="description">{{ description }}</small></span>
    <input v-model="model" class="ui-switch__input" type="checkbox" role="switch" :disabled="disabled" />
    <span class="ui-switch__track" aria-hidden="true"><span /></span>
  </label>
</template>
