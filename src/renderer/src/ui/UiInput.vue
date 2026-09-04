<script setup lang="ts">
import { computed, inject } from 'vue'
import { uiFieldContextKey } from './field-context'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  id?: string
  type?: string
  disabled?: boolean
  required?: boolean
  invalid?: boolean
  describedBy?: string
}>(), {
  type: 'text',
  disabled: false,
  required: false,
  invalid: false
})
const [model, modifiers] = defineModel<string | number | undefined>({
  set(value) {
    if (modifiers.trim && typeof value === 'string') return value.trim()
    if (modifiers.number && typeof value === 'string' && value !== '') return Number(value)
    return value
  }
})
const field = inject(uiFieldContextKey, undefined)
const controlId = computed(() => props.id ?? field?.controlId.value)
const describedBy = computed(() => props.describedBy ?? field?.describedBy.value)
const invalid = computed(() => props.invalid || field?.invalid.value || undefined)
const required = computed(() => props.required || field?.required.value || undefined)
const disabled = computed(() => props.disabled || field?.disabled.value || undefined)
</script>

<template>
  <input
    v-bind="$attrs"
    :id="controlId"
    v-model="model"
    class="ui-control ui-input"
    :type="type"
    :disabled="disabled"
    :required="required"
    :aria-invalid="invalid"
    :aria-describedby="describedBy"
  />
</template>
