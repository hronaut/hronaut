<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import UiPopover from '../ui/UiPopover.vue'
import '../styles/mcp-readiness.css'
import { useI18n } from 'vue-i18n'
import IconPause from '~icons/material-symbols/pause-rounded'
import IconPlay from '~icons/material-symbols/play-arrow-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import type { McpStatusControlsController } from '../composables/useMcpStatusController'
import { vTooltip } from '../ui/tooltip.js'
import { agentStatus } from '../../../shared/agent-status.js'
import { mcpPortProblem } from '../../../shared/mcp-port.js'

const props = defineProps<{
  controller: McpStatusControlsController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  endpoint,
  state,
  copied,
  pauseBusy,
  portBusy,
  portFailed,
  canTogglePaused,
  copyEndpoint,
  togglePaused,
  moveToSuggestedPort
} = props.controller

// The same words as Home: whether agents can connect, and whether one needs you, is working or is connected.
const agents = computed(() => agentStatus(state.value.status, state.value.agents ?? []))
const statusLabel = computed(() => {
  if (state.value.status === 'paused' && (state.value.activeCommands ?? 0) > 0) return t('runtime.mcp.settling', { count: state.value.activeCommands! })
  return t(`agentStatus.${agents.value.message}`, { name: agents.value.name ?? '', count: agents.value.count }, agents.value.count)
})
// A busy or forbidden port says so in plain words and offers the free port main found.
const portProblem = computed(() => {
  const problem = mcpPortProblem(state.value)
  return problem ? t(`runtime.mcp.${problem.key}`, { port: problem.port }) : ''
})
const portFailure = computed(() => portFailed.value
  ? t(`runtime.mcp.${portFailed.value.outcome === 'taken' ? 'portTaken' : 'portMoveFailed'}`, { port: portFailed.value.port })
  : '')
const summary = ref<HTMLElement | null>(null)
/** After a move the offer disappears with its button, so focus goes to copying the new address. */
async function usePort(): Promise<void> {
  const result = await moveToSuggestedPort()
  if (result?.outcome !== 'moved') return
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) summary.value?.querySelector<HTMLElement>('.mcp-copy-endpoint')?.focus()
}
const statusDetail = computed(() => {
  if (portProblem.value) return { text: portProblem.value, namesAgent: false }
  if (state.value.status === 'error') return { text: t('runtime.mcp.failed', { error: state.value.error ?? t('runtime.mcp.unknown') }), namesAgent: false }
  if (state.value.status === 'starting') return { text: t('runtime.mcp.startingAt', { url: endpoint.value }), namesAgent: false }
  if (state.value.paused) return { text: t('runtime.mcp.pauseGuidance'), namesAgent: false }
  return { text: t('runtime.mcp.title', { url: endpoint.value }), namesAgent: Boolean(agents.value.name) }
})
// The label cuts a long client name, so the tooltip leads with the whole status for pointer users. The button's name
// already says it whole, so screen readers get only the detail as its description.
const statusTitle = computed(() => statusDetail.value.namesAgent ? `${statusLabel.value}. ${statusDetail.value.text}` : statusDetail.value.text)
const statusDescription = computed(() => statusDetail.value.namesAgent ? statusDetail.value.text : undefined)
const pauseTitle = computed(() => {
  if (pauseBusy.value) return t('runtime.locks.waiting')
  if (!canTogglePaused.value) return t('runtime.mcp.unavailable')
  if (!state.value.paused) return t('runtime.mcp.pauseCommands')
  const guidance = t('runtime.mcp.resumeCommands')
  return (state.value.activeCommands ?? 0) > 0
    ? `${t('runtime.mcp.settling', { count: state.value.activeCommands! })}. ${guidance}`
    : guidance
})

const { summaryOpen } = props.controller
let summaryTimer: ReturnType<typeof setTimeout> | undefined
let summaryGeneration = 0
watch(summaryOpen, (open) => {
  const generation = ++summaryGeneration
  clearTimeout(summaryTimer)
  if (!open) return
  const refresh = async (): Promise<void> => {
    await props.controller.refresh()
    if (generation === summaryGeneration) summaryTimer = setTimeout(() => void refresh(), 2000)
  }
  void refresh()
})
onBeforeUnmount(() => { summaryGeneration++; clearTimeout(summaryTimer) })
</script>

<template>
  <div class="mcp-controls" :class="[state.status, { 'needs-you': agents.kind === 'needs-you' }]">
    <UiPopover v-model="summaryOpen" class="mcp-summary" trigger-class="mcp-pill" :label="statusLabel" :title="statusTitle" :description="statusDescription" placement="bottom-end" holds-page>
      <template #trigger><span class="status-dot" /><span class="mcp-pill-label">{{ statusLabel }}</span></template>
      <section ref="summary" class="mcp-readiness-summary" :aria-label="t('home.readiness.heading')">
        <strong>{{ t('home.readiness.heading') }}</strong>
        <div v-if="portProblem" class="mcp-port-problem" role="alert">
          <p>{{ portProblem }} {{ state.suggestedPort ? t('runtime.mcp.portNote') : t('runtime.mcp.portNoneFree') }}</p>
          <p v-if="portFailure" class="mcp-port-taken">{{ portFailure }}</p>
          <UiButton v-if="state.suggestedPort" size="small" variant="primary" :busy="portBusy" @click="usePort">{{ t('runtime.mcp.usePort', { port: state.suggestedPort }) }}</UiButton>
        </div>
        <dl>
          <div><dt>{{ t('home.readiness.checks.endpoint') }}</dt><dd>{{ t(`runtime.mcp.${state.status === 'ready' ? 'ready' : state.status === 'paused' ? 'paused' : state.status === 'error' ? 'error' : 'starting'}`) }}</dd></div>
          <div><dt>{{ t('home.readiness.checks.initialization') }}</dt><dd>{{ state.readiness ? state.readiness.initializedClientCount : '—' }}</dd></div>
          <div><dt>{{ t('home.readiness.checks.probe') }}</dt><dd>{{ t(state.readiness?.probe === 'probe_verified' ? 'home.activity.done' : state.readiness?.probe === 'probe_failed' ? 'home.activity.failed' : 'home.readiness.nextAction.run_read_only_probe') }}</dd></div>
        </dl>
        <p v-if="props.controller.refreshFailed.value" role="status">{{ t('home.journey.unavailable') }}</p>
        <p v-else>{{ t(state.paused ? 'runtime.mcp.pauseGuidance' : !state.readiness?.initializedClientCount ? 'home.readiness.nextAction.connect_client' : state.readiness.probe === 'probe_verified' ? 'home.readiness.nextAction.none' : state.readiness.probe === 'probe_failed' ? 'home.readiness.nextAction.retry_read_only_probe' : 'home.readiness.nextAction.run_read_only_probe') }}</p>
        <code>{{ endpoint }}</code>
        <UiButton class="mcp-copy-endpoint" size="small" @click="copyEndpoint">{{ t(copied ? 'runtime.mcp.copied' : 'home.copyUrl') }}</UiButton>
      </section>
    </UiPopover>
    <UiButton appearance="application"
      class="mcp-pause-button"
      type="button"
      v-tooltip="pauseTitle"
      :aria-description="pauseTitle"
      :aria-busy="pauseBusy"
      :aria-label="(pauseBusy ? t('runtime.locks.waiting') + ': ' : '') + t(state.paused ? 'runtime.mcp.resumeAgents' : 'runtime.mcp.pauseAgents')"
      :aria-pressed="state.paused"
      :disabled="!canTogglePaused"
      @click="togglePaused"
    >
      <IconProgress v-if="pauseBusy" class="state-spinner" aria-hidden="true" />
      <IconPlay v-else-if="state.paused" aria-hidden="true" />
      <IconPause v-else aria-hidden="true" />
      <span class="mcp-pause-label">{{ t(state.paused ? 'runtime.mcp.resumeAgents' : 'runtime.mcp.pauseAgents') }}</span>
    </UiButton>
  </div>
</template>
