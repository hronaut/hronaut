<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconSmartToy from '~icons/material-symbols/smart-toy-outline-rounded'
import { AGENT_STEP_HISTORY_LIMIT, agentAvatarColorHex, type AgentPresence, type HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import type { BrowserState } from '../../../shared/types.js'
import { agentStepText } from '../composables/agent-step-text.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import { useAgentStepHistory, type AgentStepHistoryTarget, type ShownAgentStep } from '../composables/useAgentStepHistory.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'
import UiButton from '../ui/UiButton.vue'
import UiOverlayTransition from '../ui/UiOverlayTransition.vue'

const props = defineProps<{
  /** The agent and workspace whose steps are shown. */
  target: AgentStepHistoryTarget | null
  state: BrowserState
  selectTab: (tabId: string) => Promise<unknown>
  formatTime: (value: Date | number | string) => string
  formatNumber: (value: number) => string
  formatError: (cause: unknown, fallback: string) => string
  showError: (title: string, message: string) => void
  presenceApi?: HronautAgentPresenceApi
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const presenceApi = props.presenceApi ?? window.hronautAgentPresence
const presence = useAgentPresence(presenceApi)
const shownTarget = computed(() => (open.value ? props.target : null))
const history = useAgentStepHistory({
  api: presenceApi,
  target: () => shownTarget.value,
  revision: () => presence.snapshot.value.revision
})
const panel = ref<HTMLElement | null>(null)

// The agent as last seen, so its name and color stay once it has left the toolbar.
const agent = shallowRef<AgentPresence>()
watch([shownTarget, () => presence.snapshot.value], ([target, snapshot], [previousTarget]) => {
  if (target?.clientKey !== previousTarget?.clientKey || target?.workspaceId !== previousTarget?.workspaceId) agent.value = undefined
  const live = target ? snapshot.workspaces[target.workspaceId]?.find((candidate) => candidate.clientKey === target.clientKey) : undefined
  if (live) agent.value = live
}, { immediate: true })

const name = computed(() => agent.value?.name || t('shell.agents.unnamed'))
const workspaceName = computed(() => {
  const workspaceId = shownTarget.value?.workspaceId
  return (workspaceId && props.state.mcpTabGroups.find((group) => group.id === workspaceId)?.name) || ''
})

interface StepGroup {
  key: string
  kind: 'tab' | 'closed' | 'none'
  tabId?: string
  steps: ShownAgentStep[]
}

// Steps in a row on the same tab share one heading; the order stays newest first.
const groups = computed<StepGroup[]>(() => {
  const result: StepGroup[] = []
  for (const step of history.steps.value) {
    const kind = step.tabId ? 'tab' : step.tabClosed ? 'closed' : 'none'
    const last = result.at(-1)
    if (last && last.kind === kind && last.tabId === step.tabId) last.steps.push(step)
    else result.push({ key: step.id, kind, ...(step.tabId ? { tabId: step.tabId } : {}), steps: [step] })
  }
  return result
})

function tabTitle(tabId: string): string {
  const tab = props.state.tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return t('agentSteps.closedTab')
  const title = tab.label || tab.title
  if (title.trim()) return title
  try {
    return new URL(tab.url).host || tab.url
  } catch {
    return tab.url || t('agentSteps.untitledTab')
  }
}

function groupHeading(group: StepGroup): string {
  if (group.kind === 'tab' && group.tabId) return tabTitle(group.tabId)
  return t(group.kind === 'closed' ? 'agentSteps.closedTab' : 'agentSteps.noTab')
}

function canShow(group: StepGroup): boolean {
  return group.kind === 'tab' && group.tabId !== undefined && props.state.tabs.some((tab) => tab.id === group.tabId)
}

function stepText(step: ShownAgentStep): string {
  return agentStepText(t, step.step, step.target, 'done')
}

let showing = 0
async function showTab(tabId: string): Promise<void> {
  open.value = false
  const current = ++showing
  try {
    await props.selectTab(tabId)
  } catch (cause) {
    // Showing another tab since is newer; a late failure does not cover it.
    if (current === showing) props.showError(t('agentSteps.showTabFailed'), props.formatError(cause, t('agentSteps.showTabFailedDescription')))
  }
}

function close(): void {
  open.value = false
}

useModalDialogFocus({ open, panel })
defineExpose({ close })
onBeforeUnmount(() => {
  showing += 1
  history.dispose()
  presence.dispose()
})
</script>

<template>
  <UiOverlayTransition>
    <div v-if="open && target" class="settings-overlay command-palette-overlay" @click.self="close">
      <section
        ref="panel"
        class="command-palette agent-steps-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-steps-title"
        aria-describedby="agent-steps-summary"
        data-testid="agent-steps"
        tabindex="-1"
      >
        <header class="command-palette-header">
          <span class="agent-steps-avatar" :style="{ '--agent-color': agentAvatarColorHex(agent?.colorIndex ?? 0) }" aria-hidden="true">
            <template v-if="agent?.initial">{{ agent.initial }}</template>
            <IconSmartToy v-else />
          </span>
          <div>
            <span class="eyebrow">{{ t('agentSteps.kicker') }}</span>
            <h2 id="agent-steps-title">{{ t('agentSteps.heading', { name }) }}</h2>
          </div>
          <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('agentSteps.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
        </header>
        <p id="agent-steps-summary" class="agent-steps-summary">
          {{ workspaceName
            ? t('agentSteps.summary', { count: formatNumber(AGENT_STEP_HISTORY_LIMIT), workspace: workspaceName })
            : t('agentSteps.summaryNoWorkspace', { count: formatNumber(AGENT_STEP_HISTORY_LIMIT) }) }}
        </p>
        <p v-if="history.closed.value" class="agent-steps-notice" role="status">{{ t('agentSteps.ended', { name }) }}</p>
        <div v-if="history.failed.value" class="agent-steps-notice agent-steps-notice--failed">
          <p role="status">{{ t('agentSteps.loadFailed') }}</p>
          <UiButton variant="ghost" size="small" type="button" @click="history.retry()">{{ t('agentSteps.retry') }}</UiButton>
        </div>
        <div v-if="groups.length" class="agent-steps-list">
          <section v-for="group in groups" :key="group.key" class="agent-steps-group" :aria-labelledby="`agent-steps-group-${group.key}`">
            <header class="agent-steps-group-header">
              <h3 :id="`agent-steps-group-${group.key}`" :class="{ muted: group.kind !== 'tab' }">{{ groupHeading(group) }}</h3>
              <UiButton
                v-if="canShow(group)"
                variant="ghost"
                size="small"
                type="button"
                :aria-label="t('agentSteps.showTabNamed', { title: groupHeading(group) })"
                @click="showTab(group.tabId!)"
              >{{ t('agentSteps.showTab') }}</UiButton>
            </header>
            <ol class="agent-steps-items">
              <li v-for="step in group.steps" :key="step.id" class="agent-steps-item" :data-outcome="step.outcome">
                <img
                  v-if="step.thumbnail"
                  class="agent-steps-picture"
                  :src="step.thumbnail.dataUrl"
                  :width="step.thumbnail.width"
                  :height="step.thumbnail.height"
                  alt=""
                  draggable="false"
                />
                <span v-else-if="group.kind !== 'none'" class="agent-steps-picture agent-steps-picture--none" aria-hidden="true"><IconHistory /></span>
                <span class="agent-steps-copy">
                  <span class="agent-steps-text">
                    <IconError v-if="step.outcome === 'failed'" aria-hidden="true" />
                    <IconCheck v-else aria-hidden="true" />
                    <span>{{ step.outcome === 'failed' ? t('shell.agentCard.stepFailed', { step: stepText(step) }) : stepText(step) }}</span>
                  </span>
                  <time class="agent-steps-time" :datetime="new Date(step.at).toISOString()">{{ formatTime(step.at) }}</time>
                </span>
              </li>
            </ol>
          </section>
        </div>
        <div v-else-if="history.loaded.value" class="command-palette-empty">
          <IconHistory aria-hidden="true" />
          <strong>{{ t('agentSteps.empty') }}</strong>
          <span>{{ t('agentSteps.emptyDescription', { name }) }}</span>
        </div>
        <footer class="agent-steps-footer">{{ t('agentSteps.privacy') }}</footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
