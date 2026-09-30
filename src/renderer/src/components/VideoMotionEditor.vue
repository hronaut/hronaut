<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'
import type { BrowserVideoOptions, BrowserVideoState } from '../../../shared/video.js'

const props = defineProps<{ state: BrowserVideoState; busy: boolean }>()
const emit = defineEmits<{ edit: [options: Partial<BrowserVideoOptions>] }>()
const { t } = useI18n({ useScope: 'global' })
const start = ref(0), end = ref(Math.min(2, props.state.durationMs / 1000)), x = ref(50), y = ref(50), zoom = ref(1.5)
const pan = ref(false), endX = ref(50), endY = ref(50), endZoom = ref(1.5), ease = ref(300)
const transition = ref(props.state.transition?.durationMs ?? 0)
const cameras = computed(() => props.state.cameras ?? [])
function add(): void {
  emit('edit', { cameras: [...cameras.value, {
    startMs: start.value * 1000, endMs: end.value * 1000, x: x.value / 100, y: y.value / 100, zoom: zoom.value, easeMs: ease.value,
    ...(pan.value ? { endX: endX.value / 100, endY: endY.value / 100, endZoom: endZoom.value } : {})
  }].sort((a, b) => a.startMs - b.startMs) })
}
watch(() => props.state.transition?.durationMs, value => { transition.value = value ?? 0 })
</script>

<template>
  <details class="video-section">
    <summary>{{ t('video.motion.title') }} <span>{{ cameras.length }}</span></summary>
    <fieldset :disabled="busy">
      <legend>{{ t('video.motion.camera') }}</legend>
      <p class="video-help">{{ t('video.motion.help') }}</p>
      <div class="video-fields">
        <label>{{ t('video.motion.from') }}<input v-model.number="start" type="number" min="0" :max="state.durationMs / 1000" step="0.1" /></label>
        <label>{{ t('video.motion.to') }}<input v-model.number="end" type="number" min="0" :max="state.durationMs / 1000" step="0.1" /></label>
        <label>{{ t('video.motion.x') }}<input v-model.number="x" type="number" min="0" max="100" /></label>
        <label>{{ t('video.motion.y') }}<input v-model.number="y" type="number" min="0" max="100" /></label>
        <label>{{ t('video.motion.zoom') }}<input v-model.number="zoom" type="number" min="1" max="3" step="0.1" /></label>
        <label>{{ t('video.motion.ease') }}<input v-model.number="ease" type="number" min="0" max="2000" step="50" /></label>
      </div>
      <label class="video-check"><input v-model="pan" type="checkbox" />{{ t('video.motion.pan') }}</label>
      <div v-if="pan" class="video-fields">
        <label>{{ t('video.motion.endX') }}<input v-model.number="endX" type="number" min="0" max="100" /></label>
        <label>{{ t('video.motion.endY') }}<input v-model.number="endY" type="number" min="0" max="100" /></label>
        <label>{{ t('video.motion.endZoom') }}<input v-model.number="endZoom" type="number" min="1" max="3" step="0.1" /></label>
      </div>
      <UiButton @click="add">{{ t('video.motion.add') }}</UiButton>
      <ol v-if="cameras.length" class="video-items">
        <li v-for="(camera, index) in cameras" :key="index">
          <span>{{ camera.startMs / 1000 }} · {{ camera.endMs / 1000 }} {{ t('video.seconds') }} · {{ camera.zoom }}× <template v-if="camera.endZoom !== undefined">→ {{ camera.endZoom }}×</template></span>
          <UiButton :aria-label="t('video.motion.remove', { index: index + 1 })" @click="emit('edit', { cameras: cameras.filter((_, i) => i !== index) })">{{ t('video.remove') }}</UiButton>
        </li>
      </ol>
    </fieldset>
    <fieldset :disabled="busy">
      <legend>{{ t('video.motion.transitions') }}</legend>
      <p class="video-help">{{ t('video.motion.transitionHelp') }}</p>
      <label>{{ t('video.motion.fade') }}<input v-model.number="transition" type="number" min="0" max="1000" step="50" /></label>
      <UiButton @click="emit('edit', { transition: { durationMs: transition } })">{{ t('video.motion.apply') }}</UiButton>
    </fieldset>
  </details>
</template>
