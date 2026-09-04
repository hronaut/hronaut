<script setup lang="ts">
import { computed, getCurrentInstance, ref, watchEffect } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  label?: string
  modelValue?: boolean
  checked?: boolean
  disabled?: boolean
  indeterminate?: boolean
  bare?: boolean
}>(), {
  disabled: false,
  indeterminate: false,
  bare: false
})
const emit = defineEmits<{ 'update:modelValue': [checked: boolean] }>()
const instance = getCurrentInstance()
const input = ref<HTMLInputElement | null>(null)
const usesModel = computed(() => {
  const vnodeProps = instance?.vnode.props ?? {}
  return Object.hasOwn(vnodeProps, 'modelValue') || Object.hasOwn(vnodeProps, 'model-value')
})
const isChecked = computed(() => usesModel.value ? props.modelValue : props.checked ?? false)
watchEffect(() => {
  if (input.value) input.value.indeterminate = props.indeterminate
})

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <input v-if="bare" v-bind="$attrs" ref="input" class="ui-checkbox" type="checkbox" :checked="isChecked" :disabled="disabled" @change="onChange" />
  <label v-else class="ui-check" :class="{ 'ui-check--disabled': disabled }">
    <input v-bind="$attrs" ref="input" type="checkbox" :checked="isChecked" :disabled="disabled" @change="onChange" />
    <span v-if="label || $slots.default"><slot>{{ label }}</slot></span>
  </label>
</template>
