<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'
import { VIDEO_ANNOTATION_KINDS, VIDEO_PLACEMENTS, VIDEO_TEXT_PRESETS, videoAnnotationSchema, videoOptionsSchema, type BrowserVideoOptions, type BrowserVideoState, type VideoAnnotation } from '../../../shared/video.js'

const props = defineProps<{ tabId: string }>()
const { t } = useI18n({ useScope: 'global' })
const state = ref<BrowserVideoState | null>(null)
const busy = ref(false)
const error = ref('')
const previewUrl = ref('')
const kind = ref<VideoAnnotation['kind']>('text')
const caption = ref('')
const title = ref(''), step = ref<number | ''>('')
const preset = ref<NonNullable<VideoAnnotation['preset']>>('caption')
const placement = ref<NonNullable<VideoAnnotation['placement']>>('bottom-center')
const size = ref<NonNullable<VideoAnnotation['size']>>('medium')
const theme = ref<NonNullable<VideoAnnotation['theme']>>('dark')
const align = ref<NonNullable<VideoAnnotation['align']>>('left')
const animation = ref<NonNullable<VideoAnnotation['animation']>>('fade')
const color = ref('#7c3aed'), cardWidth = ref(56)
const textElement = computed(() => kind.value === 'text' || kind.value === 'callout')
const needsEnd = computed(() => ['callout', 'arrow', 'highlight', 'spotlight'].includes(kind.value))
const start = ref(0), end = ref(1), x = ref(10), y = ref(10), endX = ref(50), endY = ref(50)
const clipStart = ref(0), clipEnd = ref(1)
const stopped = computed(() => state.value?.status === 'stopped')
let revision = 0
let disposed = false
let poll: ReturnType<typeof setTimeout> | undefined
function clearPreview(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}
async function refresh(): Promise<void> {
  const expected = revision, tabId = props.tabId
  try {
    if (!busy.value) {
      const result = await window.hronaut.manageVideo({ tabId, action: 'get' })
      if (!disposed && expected === revision && tabId === props.tabId && !busy.value) state.value = result
    }
  } catch { /* Explicit operations report errors; polling never replaces an in-flight result. */ }
  finally { if (!disposed && expected === revision) poll = setTimeout(() => { void refresh() }, 1000) }
}
async function manage(action: BrowserVideoOptions['action'], extra: Partial<BrowserVideoOptions> = {}): Promise<void> {
  if (busy.value) return
  const expected = ++revision, tabId = props.tabId
  if (poll) clearTimeout(poll)
  busy.value = true; error.value = ''
  try {
    const result = await window.hronaut.manageVideo(videoOptionsSchema.parse({ ...extra, tabId, action }))
    if (disposed || expected !== revision || tabId !== props.tabId) return
    state.value = result
    if (action === 'clear' || action === 'edit') clearPreview()
    if ((action === 'render' || action === 'export') && result.previewReady) {
      const data = await window.hronaut.videoPreview(tabId)
      if (disposed || expected !== revision || tabId !== props.tabId) return
      clearPreview()
      previewUrl.value = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'video/webm' }))
    }
  } catch (cause) {
    if (!disposed && expected === revision) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (!disposed && expected === revision) { busy.value = false; void refresh() }
  }
}
async function addAnnotation(): Promise<void> {
  try {
    const annotation = videoAnnotationSchema.parse({
      kind: kind.value, startMs: start.value * 1000, endMs: end.value * 1000,
      ...(!textElement.value || placement.value === 'custom' ? { x: x.value / 100, y: y.value / 100 } : {}),
      ...(needsEnd.value ? { endX: endX.value / 100, endY: endY.value / 100 } : {}),
      ...(textElement.value ? { text: caption.value, preset: preset.value, placement: placement.value, width: cardWidth.value / 100, size: size.value, theme: theme.value, align: align.value } : {}),
      ...(kind.value === 'callout' ? { title: title.value || undefined, step: step.value === '' ? undefined : step.value } : {}),
      color: color.value, animation: animation.value
    })
    await manage('edit', { annotations: [...(state.value?.annotations ?? []), annotation] })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
watch(kind, value => {
  if (value === 'callout') { placement.value = 'auto'; cardWidth.value = 30 }
  else if (value === 'text') { placement.value = 'bottom-center'; cardWidth.value = 56 }
})
watch(() => props.tabId, () => {
  revision += 1
  if (poll) clearTimeout(poll)
  state.value = null; busy.value = false; error.value = ''; clearPreview()
  void refresh()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; revision += 1; if (poll) clearTimeout(poll); clearPreview() })
</script>

<template>
  <section class="video-recorder" :aria-label="t('video.title')" :aria-busy="busy">
    <p>{{ t('video.privacy') }}</p>
    <p v-if="state" role="status">{{ t(`video.status.${state.status}`) }} · {{ (state.durationMs / 1000).toFixed(1) }} {{ t('video.seconds') }}</p>
    <p v-if="state?.notice">{{ state.notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="video-actions">
      <UiButton variant="primary" v-if="!state || state.status === 'idle'" :disabled="busy" @click="manage('start')">{{ t('video.start') }}</UiButton>
      <UiButton v-if="state?.status === 'recording'" :disabled="busy" @click="manage('pause')">{{ t('video.pause') }}</UiButton>
      <UiButton v-if="state?.status === 'paused'" :disabled="busy" @click="manage('resume')">{{ t('video.resume') }}</UiButton>
      <UiButton v-if="state?.status === 'recording' || state?.status === 'paused'" :disabled="busy" @click="manage('stop')">{{ t('video.stop') }}</UiButton>
      <UiButton v-if="state && state.status !== 'idle'" :disabled="busy" @click="manage('clear')">{{ t('video.clear') }}</UiButton>
    </div>
    <template v-if="stopped">
      <fieldset :disabled="busy">
        <legend>{{ t('video.annotation') }}</legend>
        <label>{{ t('video.kind') }}<select v-model="kind"><option v-for="option in VIDEO_ANNOTATION_KINDS" :key="option" :value="option">{{ t(`video.kinds.${option}`) }}</option></select></label>
        <label v-if="textElement">{{ t('video.caption') }}<textarea v-model="caption" maxlength="240" rows="2" /></label>
        <template v-if="kind === 'callout'">
          <label>{{ t('video.cardTitle') }}<input v-model="title" maxlength="80" /></label>
          <label>{{ t('video.step') }}<input v-model.number="step" type="number" min="1" max="99" /></label>
        </template>
        <div v-if="textElement" class="video-fields">
          <label>{{ t('video.preset') }}<select v-model="preset"><option v-for="option in VIDEO_TEXT_PRESETS" :key="option" :value="option">{{ t(`video.presets.${option}`) }}</option></select></label>
          <label>{{ t('video.placement') }}<select v-model="placement"><option v-for="option in VIDEO_PLACEMENTS" :key="option" :value="option">{{ t(`video.placements.${option}`) }}</option></select></label>
          <label>{{ t('video.size') }}<select v-model="size"><option v-for="option in (['small', 'medium', 'large'] as const)" :key="option" :value="option">{{ t(`video.sizes.${option}`) }}</option></select></label>
          <label>{{ t('video.theme') }}<select v-model="theme"><option value="dark">{{ t('video.themes.dark') }}</option><option value="light">{{ t('video.themes.light') }}</option></select></label>
          <label>{{ t('video.width') }}<input v-model.number="cardWidth" type="number" min="15" max="90" /></label>
          <label>{{ t('video.align') }}<select v-model="align"><option value="left">{{ t('video.alignments.left') }}</option><option value="center">{{ t('video.alignments.center') }}</option><option value="right">{{ t('video.alignments.right') }}</option></select></label>
        </div>
        <div class="video-fields">
          <label>{{ t('video.from') }}<input v-model.number="start" type="number" min="0" step="0.1" /></label>
          <label>{{ t('video.to') }}<input v-model.number="end" type="number" min="0" step="0.1" /></label>
          <template v-if="!textElement || placement === 'custom'">
            <label>{{ t('video.x') }}<input v-model.number="x" type="number" min="0" max="100" /></label>
            <label>{{ t('video.y') }}<input v-model.number="y" type="number" min="0" max="100" /></label>
          </template>
          <template v-if="needsEnd">
            <label>{{ t('video.endX') }}<input v-model.number="endX" type="number" min="0" max="100" /></label>
            <label>{{ t('video.endY') }}<input v-model.number="endY" type="number" min="0" max="100" /></label>
          </template>
          <label>{{ t('video.color') }}<input v-model="color" type="color" /></label>
          <label>{{ t('video.animation') }}<select v-model="animation"><option v-for="option in (['none', 'fade', 'draw'] as const)" :key="option" :value="option">{{ t(`video.animations.${option}`) }}</option></select></label>
        </div>
        <p v-if="textElement" class="video-help">{{ t('video.positionHelp') }}</p>
        <UiButton @click="addAnnotation">{{ t('video.addAnnotation') }}</UiButton>
      </fieldset>
      <ol v-if="state?.annotations.length">
        <li v-for="(annotation, index) in state.annotations" :key="index">
          <span>{{ t(`video.kinds.${annotation.kind}`) }} · {{ annotation.startMs / 1000 }} · {{ annotation.endMs / 1000 }} · {{ annotation.text }}</span>
          <UiButton :disabled="busy" :aria-label="t('video.removeAnnotation', { index: index + 1 })" @click="manage('edit', { annotations: state.annotations.filter((_, i) => i !== index) })">{{ t('video.remove') }}</UiButton>
        </li>
      </ol>
      <fieldset :disabled="busy">
        <legend>{{ t('video.clips') }}</legend>
        <p>{{ t('video.clipsHelp') }}</p>
        <div class="video-fields">
          <label>{{ t('video.from') }}<input v-model.number="clipStart" type="number" min="0" step="0.1" /></label>
          <label>{{ t('video.to') }}<input v-model.number="clipEnd" type="number" min="0" step="0.1" /></label>
        </div>
        <UiButton @click="manage('edit', { clips: [...(state?.clips ?? []), { startMs: clipStart * 1000, endMs: clipEnd * 1000 }] })">{{ t('video.addClip') }}</UiButton>
        <UiButton v-if="state?.clips.length" @click="manage('edit', { clips: [{ startMs: 0, endMs: state.durationMs }] })">{{ t('video.wholeRecording') }}</UiButton>
        <ol><li v-for="(clip, index) in state?.clips" :key="index">{{ clip.startMs / 1000 }} · {{ clip.endMs / 1000 }} {{ t('video.seconds') }}<UiButton v-if="state && state.clips.length > 1" @click="manage('edit', { clips: state.clips.filter((_, i) => i !== index) })">{{ t('video.remove') }}</UiButton></li></ol>
      </fieldset>
      <div class="video-actions">
        <UiButton :disabled="busy || !state?.frameCount" @click="manage('render')">{{ t('video.preview') }}</UiButton>
        <UiButton variant="primary" :disabled="busy || !state?.frameCount" @click="manage('export')">{{ t('video.export') }}</UiButton>
      </div>
    </template>
    <video v-if="previewUrl" :src="previewUrl" controls playsinline :aria-label="t('video.preview')" />
    <p v-if="state?.exported">{{ t('video.saved') }} <code>{{ state.exported.path }}</code></p>
    <small>{{ t('video.limits') }}</small>
  </section>
</template>

<style scoped>
.video-recorder { grid-column: 1 / -1; display: grid; gap: 12px; min-width: 0; }
.video-recorder p { margin: 0; }
.video-recorder fieldset { display: grid; gap: 10px; min-width: 0; border: 1px solid var(--border-soft); border-radius: 8px; padding: 10px; }
.video-recorder label { display: grid; gap: 4px; min-width: 0; }
.video-recorder input, .video-recorder select, .video-recorder textarea { width: 100%; min-width: 0; box-sizing: border-box; padding: 6px; color: inherit; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 4px; }
.video-recorder textarea { resize: vertical; font: inherit; }
.video-recorder input[type="color"] { height: 32px; padding: 3px; }
.video-help { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.video-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.video-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.video-recorder video { width: 100%; border-radius: 8px; }
.video-recorder code { overflow-wrap: anywhere; }
.video-recorder li { margin-bottom: 6px; }
</style>
