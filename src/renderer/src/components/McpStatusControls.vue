<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconPause from '~icons/material-symbols/pause-rounded'
import IconPlay from '~icons/material-symbols/play-arrow-rounded'
import type { McpStatusController } from '../composables/useMcpStatusController'

const props = defineProps<{
  controller: McpStatusController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  endpoint,
  state,
  copied,
  canTogglePaused,
  copyEndpoint,
  togglePaused
} = props.controller

const statusLabel = computed(() => {
  if (copied.value) return t('runtime.mcp.copied')
  if (state.value.status === 'starting') return t('runtime.mcp.starting')
  if (state.value.status === 'paused') return (state.value.activeCommands ?? 0) > 0
    ? t('runtime.mcp.settling', { count: state.value.activeCommands! })
    : t('runtime.mcp.paused')
  if (state.value.status === 'error') return t('runtime.mcp.error')
  return t('runtime.mcp.ready')
})
const statusTitle = computed(() => {
  if (state.value.status === 'error') return t('runtime.mcp.failed', { error: state.value.error ?? t('runtime.mcp.unknown') })
  if (state.value.status === 'starting') return t('runtime.mcp.startingAt', { url: endpoint.value })
  if (state.value.paused) return t('runtime.mcp.pauseGuidance')
  return t('runtime.mcp.title', { url: endpoint.value })
})
const pauseTitle = computed(() => {
  if (!canTogglePaused.value) return t('runtime.mcp.unavailable')
  if (!state.value.paused) return t('runtime.mcp.pauseCommands')
  const guidance = t('runtime.mcp.resumeCommands')
  return (state.value.activeCommands ?? 0) > 0
    ? `${t('runtime.mcp.settling', { count: state.value.activeCommands! })}. ${guidance}`
    : guidance
})
</script>

<template>
  <div class="mcp-controls" :class="state.status">
    <UiButton appearance="application" class="mcp-pill" type="button" :title="statusTitle" @click="copyEndpoint">
      <span class="status-dot" />
      {{ statusLabel }}
    </UiButton>
    <UiButton appearance="application"
      class="mcp-pause-button"
      type="button"
      :title="pauseTitle"
      :aria-description="pauseTitle"
      :aria-label="t(state.paused ? 'runtime.mcp.resumeAgents' : 'runtime.mcp.pauseAgents')"
      :aria-pressed="state.paused"
      :disabled="!canTogglePaused"
      @click="togglePaused"
    >
      <IconPlay v-if="state.paused" aria-hidden="true" />
      <IconPause v-else aria-hidden="true" />
    </UiButton>
  </div>
</template>
