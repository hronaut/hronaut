<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'
import type { BrowserVideoOptions, BrowserVideoState } from '../../../shared/video.js'
import { VIDEO_AUDIO_LIMITS } from '../../../shared/video-audio.js'

const props = defineProps<{ state: BrowserVideoState; busy: boolean }>()
const emit = defineEmits<{
  edit: [options: Partial<BrowserVideoOptions>]
  import: [provenance: string]
  removeAsset: [assetId: string]
}>()
const { t } = useI18n({ useScope: 'global' })
const assetId = ref(''), start = ref(0), end = ref(1), offset = ref(0)
const volume = ref(60), fadeIn = ref(0), fadeOut = ref(0), loop = ref(false)
const provenance = ref(''), editing = ref<number | null>(null)
const assets = computed(() => props.state.audioAssets ?? [])
const events = computed(() => props.state.audio ?? [])
const importedCount = computed(() => assets.value.filter(item => !item.builtin).length)
const atEventLimit = computed(() => events.value.length >= VIDEO_AUDIO_LIMITS.events)
const canImport = computed(() => !!provenance.value.trim() && importedCount.value < VIDEO_AUDIO_LIMITS.assets)
const asset = computed(() => assets.value.find(item => item.id === assetId.value))
const outputMs = computed(() => props.state.clips.length
  ? props.state.clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0)
  : props.state.durationMs)
const assetInUse = computed(() => events.value.some(event => event.assetId === assetId.value))
function chooseAsset(): void {
  if (!asset.value) return
  const music = asset.value.id === 'builtin:ambient'
  const remaining = Math.max(0, outputMs.value / 1000 - start.value)
  end.value = start.value + (music ? remaining : Math.min(remaining, asset.value.durationMs / 1000))
  offset.value = 0; volume.value = music ? 25 : 60; loop.value = music
  fadeIn.value = fadeOut.value = music ? Math.min(300, (end.value - start.value) * 500) : 0
}
function save(): void {
  if (!asset.value || (editing.value === null && atEventLimit.value)) return
  const event = { assetId: assetId.value, startMs: start.value * 1000, endMs: end.value * 1000, offsetMs: offset.value * 1000, volume: volume.value / 100, fadeInMs: fadeIn.value, fadeOutMs: fadeOut.value, loop: loop.value }
  emit('edit', { audio: editing.value === null ? [...events.value, event] : events.value.map((item, index) => index === editing.value ? event : item) })
}
function importAudio(): void { if (canImport.value) emit('import', provenance.value.trim()) }
function edit(index: number): void {
  const event = events.value[index]
  if (!event) return
  editing.value = index; assetId.value = event.assetId
  start.value = event.startMs / 1000; end.value = event.endMs / 1000; offset.value = event.offsetMs / 1000
  volume.value = event.volume * 100; fadeIn.value = event.fadeInMs; fadeOut.value = event.fadeOutMs; loop.value = event.loop
}
function reset(): void { editing.value = null; start.value = 0; chooseAsset() }
watch(assets, available => {
  if (!available.some(item => item.id === assetId.value)) { assetId.value = available[0]?.id ?? ''; reset() }
}, { immediate: true })
watch(() => JSON.stringify(events.value), () => { if (editing.value !== null) reset() })
function name(id: string): string { return assets.value.find(item => item.id === id)?.name ?? t('video.audio.missingAsset') }
</script>

<template>
  <details class="video-section">
    <summary>{{ t('video.audio.title') }} <span>{{ t('video.audio.capacity', { count: events.length, limit: VIDEO_AUDIO_LIMITS.events }) }}</span></summary>
    <fieldset :disabled="busy">
      <legend>{{ editing === null ? t('video.audio.add') : t('video.audio.edit') }}</legend>
      <p class="video-help">{{ t('video.audio.timingHelp', { duration: (outputMs / 1000).toFixed(1) }) }}</p>
      <label>{{ t('video.audio.asset') }}<select v-model="assetId" @change="chooseAsset"><option v-for="item in assets" :key="item.id" :value="item.id">{{ item.name }} · {{ (item.durationMs / 1000).toFixed(2) }} {{ t('video.seconds') }}</option></select></label>
      <p v-if="asset" class="video-help">{{ asset.provenance }}</p>
      <div class="video-fields">
        <label>{{ t('video.audio.from') }}<input v-model.number="start" type="number" min="0" :max="outputMs / 1000" step="0.01" /></label>
        <label>{{ t('video.audio.to') }}<input v-model.number="end" type="number" min="0" :max="outputMs / 1000" step="0.01" /></label>
        <label>{{ t('video.audio.volume') }}<input v-model.number="volume" type="number" min="0" max="100" /></label>
        <label>{{ t('video.audio.offset') }}<input v-model.number="offset" type="number" min="0" :max="(asset?.durationMs ?? 0) / 1000" step="0.01" /></label>
        <label>{{ t('video.audio.fadeIn') }}<input v-model.number="fadeIn" type="number" min="0" :max="Math.max(0, (end - start) * 1000)" step="10" /></label>
        <label>{{ t('video.audio.fadeOut') }}<input v-model.number="fadeOut" type="number" min="0" :max="Math.max(0, (end - start) * 1000)" step="10" /></label>
      </div>
      <label class="video-check"><input v-model="loop" type="checkbox" />{{ t('video.audio.loop') }}</label>
      <div class="video-actions">
        <UiButton :disabled="!asset || (editing === null && atEventLimit)" @click="save">{{ editing === null ? t('video.audio.add') : t('video.audio.save') }}</UiButton>
        <UiButton v-if="editing !== null" @click="reset">{{ t('video.audio.cancelEdit') }}</UiButton>
      </div>
      <ol v-if="events.length" class="video-items">
        <li v-for="(event, index) in events" :key="index">
          <span>{{ name(event.assetId) }} · {{ event.startMs / 1000 }} · {{ event.endMs / 1000 }} {{ t('video.seconds') }} · {{ Math.round(event.volume * 100) }}%</span>
          <div class="video-actions">
            <UiButton :aria-label="t('video.audio.editEvent', { index: index + 1 })" @click="edit(index)">{{ t('video.audio.edit') }}</UiButton>
            <UiButton :aria-label="t('video.audio.removeEvent', { index: index + 1 })" @click="emit('edit', { audio: events.filter((_, i) => i !== index) })">{{ t('video.remove') }}</UiButton>
          </div>
        </li>
      </ol>
    </fieldset>
    <fieldset :disabled="busy">
      <legend>{{ t('video.audio.importTitle') }} <span>{{ t('video.audio.capacity', { count: importedCount, limit: VIDEO_AUDIO_LIMITS.assets }) }}</span></legend>
      <p class="video-help">{{ t('video.audio.importHelp') }}</p>
      <label>{{ t('video.audio.provenance') }}<textarea v-model="provenance" maxlength="240" rows="2" :placeholder="t('video.audio.provenanceExample')" /></label>
      <UiButton :disabled="!canImport" @click="importAudio">{{ t('video.audio.import') }}</UiButton>
      <template v-if="asset && !asset.builtin">
        <UiButton :disabled="assetInUse" @click="emit('removeAsset', asset.id)">{{ t('video.audio.removeAsset') }}</UiButton>
        <p v-if="assetInUse" class="video-help">{{ t('video.audio.removeHelp') }}</p>
      </template>
    </fieldset>
  </details>
</template>
