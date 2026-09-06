<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSplitViewResizeController } from '../composables/useSplitViewResizeController'

const { t } = useI18n({ useScope: 'global' })
const { geometry, resizing, startResize, resizeWithKeyboard, resetSize } = useSplitViewResizeController(window.hronautSplitDivider)
const style = computed(() => geometry.value ? {
  left: `${geometry.value.bounds.x}px`, top: `${geometry.value.bounds.y}px`,
  width: `${geometry.value.bounds.width}px`, height: `${geometry.value.bounds.height}px`
} : {})
</script>

<template>
  <div v-if="geometry" class="split-view-divider" :class="[geometry.orientation, { resizing }]" :style="style"
    role="separator" tabindex="0" :aria-orientation="geometry.orientation"
    :aria-label="t('runtime.tabs.splitResize')" :title="t('runtime.tabs.splitResizeHint')"
    :aria-valuetext="t('runtime.tabs.splitResizeValue', { percent: Math.round(geometry.ratio * 100) })"
    :aria-valuemin="25" :aria-valuemax="75" :aria-valuenow="Math.round(geometry.ratio * 100)"
    @pointerdown="startResize" @keydown="resizeWithKeyboard" @dblclick="resetSize" />
</template>

<style scoped>
.split-view-divider { position: fixed; z-index: 5; touch-action: none; user-select: none; -webkit-app-region: no-drag; outline: none; }
.split-view-divider::after { content: ''; position: absolute; border-radius: 2px; background: var(--muted); opacity: .4; transition: opacity 100ms; }
.vertical { cursor: col-resize; }
.horizontal { cursor: row-resize; }
.vertical::after { width: 2px; height: min(48px, 30%); left: calc(50% - 1px); top: 50%; transform: translateY(-50%); }
.horizontal::after { height: 2px; width: min(48px, 30%); top: calc(50% - 1px); left: 50%; transform: translateX(-50%); }
.split-view-divider:is(:hover, :focus-visible, .resizing)::after { opacity: 1; background: var(--accent, #8d80fa); }
.split-view-divider:focus-visible { outline: 1px solid var(--accent, #8d80fa); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .split-view-divider::after { transition: none; } }
</style>
