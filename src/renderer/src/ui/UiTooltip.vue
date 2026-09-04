<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{
  text: string
  placement?: 'top' | 'right' | 'bottom' | 'left'
}>(), {
  placement: 'top'
})
const tooltipId = `ui-tooltip-${useId()}`
</script>

<template>
  <span class="ui-tooltip" :class="`ui-tooltip--${placement}`">
    <span class="ui-tooltip__trigger" :aria-describedby="tooltipId"><slot /></span>
    <span :id="tooltipId" class="ui-tooltip__content" role="tooltip">{{ text }}</span>
  </span>
</template>
