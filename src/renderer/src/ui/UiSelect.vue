<script setup lang="ts">
import { computed, inject } from 'vue'
import { uiFieldContextKey } from './field-context'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  id?: string
  disabled?: boolean
  required?: boolean
  invalid?: boolean
  describedBy?: string
}>(), {
  disabled: false,
  required: false,
  invalid: false
})
const model = defineModel<string | number | undefined>()
const field = inject(uiFieldContextKey, undefined)
const controlId = computed(() => props.id ?? field?.controlId.value)
const describedBy = computed(() => props.describedBy ?? field?.describedBy.value)
const invalid = computed(() => props.invalid || field?.invalid.value || undefined)
const required = computed(() => props.required || field?.required.value || undefined)
const disabled = computed(() => props.disabled || field?.disabled.value || undefined)
</script>

<template>
  <select
    v-bind="$attrs"
    :id="controlId"
    v-model="model"
    class="ui-control ui-select"
    :disabled="disabled"
    :required="required"
    :aria-invalid="invalid"
    :aria-describedby="describedBy"
  ><slot /></select>
</template>
