<script setup lang="ts">
import { computed, provide, useId } from 'vue'
import { uiFieldContextKey } from './field-context'

const props = withDefaults(defineProps<{
  label: string
  forId?: string
  hint?: string
  error?: string
  required?: boolean
  disabled?: boolean
}>(), {
  required: false,
  disabled: false
})

const generatedId = useId()
const controlId = computed(() => props.forId ?? `ui-field-${generatedId}`)
const hintId = computed(() => `${controlId.value}-hint`)
const errorId = computed(() => `${controlId.value}-error`)
const describedBy = computed(() => props.error ? errorId.value : props.hint ? hintId.value : undefined)

provide(uiFieldContextKey, {
  controlId,
  describedBy,
  invalid: computed(() => Boolean(props.error)),
  required: computed(() => props.required),
  disabled: computed(() => props.disabled)
})
</script>

<template>
  <div class="ui-field" :class="{ 'ui-field--disabled': disabled }">
    <label class="ui-field__label" :for="controlId">
      {{ label }}<span v-if="required" class="ui-field__required" aria-hidden="true"> *</span>
    </label>
    <slot
      :id="controlId"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
      :required="required"
      :disabled="disabled"
    />
    <p v-if="error" :id="errorId" class="ui-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>
