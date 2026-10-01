<script setup lang="ts">
import type { BrowserReproCheckpointInput } from '../../../shared/repro-checkpoint'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDuration } from '../../../shared/format'
import type { BrowserReproRecording, BrowserReproStep, SupportedLocale } from '../../../shared/types'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  busy?: boolean
  locale: SupportedLocale
  recording: BrowserReproRecording
}>()
const emit = defineEmits<{ checkpoint: [value: BrowserReproCheckpointInput] }>()
const selector = ref('')
const condition = ref<'visible' | 'hidden' | 'text'>('visible')
const expectedText = ref('')
const reviewed = ref(false)
watch([selector, condition, expectedText, () => props.recording.checkpointContext], () => { reviewed.value = false })
function addCheckpoint(): void {
  const context = props.recording.checkpointContext
  if (!context || !reviewed.value || !selector.value.trim() || props.busy) return
  emit('checkpoint', { context, selector: selector.value.trim(), condition: condition.value, reviewed: true, ...(condition.value === 'text' ? { text: expectedText.value } : {}) })
  reviewed.value = false
}
const { t } = useI18n({ useScope: 'global' })
const timeline = ref<HTMLElement | null>(null)
const selectedIndex = ref<number | null>(null)
const selectedStep = computed(() => (
  props.recording.steps.find(step => step.index === selectedIndex.value)
  ?? props.recording.steps[0]
  ?? null
))

watch(
  () => `${props.recording.tabId}:${props.recording.startedAt ?? ''}`,
  () => { selectedIndex.value = props.recording.steps[0]?.index ?? null },
  { immediate: true }
)

watch(
  () => props.recording.steps.map(step => step.index).join(','),
  () => {
    if (!props.recording.steps.some(step => step.index === selectedIndex.value)) {
      selectedIndex.value = props.recording.steps[0]?.index ?? null
    }
  }
)

function elapsed(step: BrowserReproStep): string {
  return `+${formatDuration(props.locale, step.elapsedMs)}`
}

function select(step: BrowserReproStep): void {
  selectedIndex.value = step.index
}

async function selectAndFocus(position: number): Promise<void> {
  const bounded = Math.max(0, Math.min(props.recording.steps.length - 1, position))
  const step = props.recording.steps[bounded]
  if (!step) return
  const recordingKey = `${props.recording.tabId}:${props.recording.startedAt ?? ''}`
  selectedIndex.value = step.index
  await nextTick()
  if (
    selectedIndex.value !== step.index
    || `${props.recording.tabId}:${props.recording.startedAt ?? ''}` !== recordingKey
  ) return
  timeline.value
    ?.querySelector<HTMLButtonElement>(`[data-repro-step-index="${step.index}"]`)
    ?.focus()
}

function moveSelection(event: KeyboardEvent, step: BrowserReproStep): void {
  const position = props.recording.steps.findIndex(candidate => candidate.index === step.index)
  if (position < 0) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') void selectAndFocus(position + 1)
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') void selectAndFocus(position - 1)
  else if (event.key === 'Home') void selectAndFocus(0)
  else if (event.key === 'End') void selectAndFocus(props.recording.steps.length - 1)
  else return
  event.preventDefault()
}
</script>

<template>
  <div class="repro-review">
    <form v-if="recording.active && recording.checkpointContext" class="repro-checkpoint" @submit.prevent="addCheckpoint">
      <strong>{{ t('repro.checkpoint.title') }}</strong>
      <label>{{ t('repro.selector') }}<input v-model="selector" maxlength="500" required></label>
      <label>{{ t('repro.checkpoint.condition') }}<select v-model="condition">
        <option value="visible">{{ t('repro.checkpoint.visible') }}</option>
        <option value="hidden">{{ t('repro.checkpoint.hidden') }}</option>
        <option value="text">{{ t('repro.checkpoint.text') }}</option>
      </select></label>
      <label v-if="condition === 'text'">{{ t('repro.checkpoint.text') }}<input v-model="expectedText" maxlength="240"></label>
      <label><input v-model="reviewed" type="checkbox">{{ t('repro.checkpoint.review') }}</label>
      <UiButton appearance="application" type="submit" :disabled="busy || !reviewed || !selector.trim()">{{ t('repro.checkpoint.add') }}</UiButton>
    </form>
    <div ref="timeline" class="repro-step-list" role="listbox" :aria-label="t('repro.timelineAria')">
      <UiButton
        v-for="step in recording.steps"
        :key="step.index"
        appearance="application"
        class="repro-step"
        :class="[step.kind, { selected: step.index === selectedStep?.index }]"
        type="button"
        role="option"
        :aria-selected="step.index === selectedStep?.index"
        :tabindex="step.index === selectedStep?.index ? 0 : -1"
        :data-repro-step-index="step.index"
        @click="select(step)"
        @focus="select(step)"
        @keydown="moveSelection($event, step)"
      >
        <span class="repro-step-index">{{ step.index }}</span>
        <span class="repro-step-summary">
          <span><strong>{{ step.kind }}</strong><time :datetime="step.occurredAt">{{ elapsed(step) }}</time></span>
          <small>{{ step.description }}</small>
        </span>
      </UiButton>
    </div>
    <section v-if="selectedStep" class="repro-step-detail" role="region" :aria-label="t('repro.selectedStepAria')">
      <header>
        <div>
          <span class="eyebrow">{{ t('repro.selectedStep', { index: selectedStep.index }) }}</span>
          <strong>{{ selectedStep.description }}</strong>
        </div>
        <time :datetime="selectedStep.occurredAt">{{ elapsed(selectedStep) }}</time>
      </header>
      <dl>
        <div><dt>{{ t('repro.action') }}</dt><dd>{{ selectedStep.kind }}</dd></div>
        <div v-if="selectedStep.target"><dt>{{ t('repro.target') }}</dt><dd>{{ selectedStep.target.label || selectedStep.target.role || selectedStep.target.tag }}</dd></div>
        <div v-if="selectedStep.target"><dt>{{ t('repro.selector') }}</dt><dd><code v-if="selectedStep.target.selector">{{ selectedStep.target.selector }}</code><span v-else>{{ t('repro.selectorUnavailable') }}</span></dd></div>
        <div v-if="selectedStep.key"><dt>{{ t('repro.key') }}</dt><dd><code>{{ selectedStep.key }}</code></dd></div>
        <div v-if="selectedStep.scroll"><dt>{{ t('repro.position') }}</dt><dd><code>x={{ selectedStep.scroll.x }}, y={{ selectedStep.scroll.y }}</code></dd></div>
        <div><dt>{{ t('repro.page') }}</dt><dd><code>{{ selectedStep.url }}</code></dd></div>
      </dl>
      <p v-if="selectedStep.expectation">{{ t('repro.checkpoint.condition') }}: {{ selectedStep.expectation.condition }} <span v-if="selectedStep.expectation.text !== undefined">{{ selectedStep.expectation.text }}</span> — {{ t(selectedStep.expectation.observedMatch ? 'repro.checkpoint.matched' : 'repro.checkpoint.notMatched') }}</p>
      <p v-if="selectedStep.valueRedacted" class="repro-step-redacted">{{ t('repro.valueRedacted') }}</p>
    </section>
  </div>
</template>

<style scoped>
.repro-checkpoint { display: grid; gap: 8px; padding: 12px; }
.repro-checkpoint label { display: grid; gap: 4px; }
.repro-checkpoint input, .repro-checkpoint select { min-width: 0; max-width: 100%; }
</style>
