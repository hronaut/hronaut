<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { MAX_MCP_PORT, MIN_MCP_PORT } from '../../../shared/mcp-port'
import { isMcpToolSet } from '../../../shared/mcp-tool-sets'
import type { McpSettingsController } from '../composables/useMcpSettingsController'
import { isImeCompositionEvent } from '../keyboard-composition.js'

const props = defineProps<{
  controller: McpSettingsController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  settings,
  endpoint,
  portDraft,
  portState,
  portMessage,
  busy,
  canApplyPort,
  editPort,
  setAuthentication,
  setToolSet,
  applyPort
} = props.controller

async function changeAuthentication(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setAuthentication(input.checked))) input.checked = settings.value.mcpAuthentication
}

async function changeToolSet(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  if (!isMcpToolSet(select.value) || !(await setToolSet(select.value))) {
    select.value = settings.value.mcpToolSet
  }
}

function changePort(event: Event): void {
  editPort((event.target as HTMLInputElement).value)
}

function handlePortKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event) || event.key !== 'Enter') return
  event.preventDefault()
  void applyPort()
}
</script>

<template>
  <div class="settings-content" :aria-busy="busy">
    <div class="setting-copy">
      <h3>{{ t('settings.mcp.heading') }}</h3>
      <p>{{ t('settings.mcp.description') }}</p>
    </div>
    <div class="settings-rows">
      <label class="settings-row" for="setting-mcp-authentication">
        <span>
          <strong>{{ t('settings.mcp.require') }}</strong>
          <small>{{ t('settings.mcp.requireDescription') }}</small>
        </span>
        <input
          id="setting-mcp-authentication"
          type="checkbox"
          :checked="settings.mcpAuthentication"
          :disabled="busy"
          @change="changeAuthentication"
        />
      </label>
      <label class="settings-row" for="setting-mcp-tool-set">
        <span>
          <strong>{{ t('settings.mcp.toolSet') }}</strong>
          <small>{{ t('settings.mcp.toolSetDescription') }}</small>
        </span>
        <span class="setting-select-control">
          <select
            id="setting-mcp-tool-set"
            :value="settings.mcpToolSet"
            :disabled="busy"
            :aria-label="t('settings.mcp.toolSet')"
            @change="changeToolSet"
          >
            <option value="essentials">{{ t('settings.mcp.toolSetEssentials') }}</option>
            <option value="qa">{{ t('settings.mcp.toolSetQa') }}</option>
            <option value="complete">{{ t('settings.mcp.toolSetComplete') }}</option>
          </select>
          <small>{{ t('settings.mcp.toolSetReconnect') }}</small>
        </span>
      </label>
      <div class="settings-row mcp-port-row">
        <label for="setting-mcp-port">
          <strong>{{ t('settings.mcp.port') }}</strong>
          <small>{{ t('settings.mcp.portDescription') }}</small>
        </label>
        <div class="mcp-port-control">
          <div>
            <input
              id="setting-mcp-port"
              :value="portDraft"
              type="number"
              inputmode="numeric"
              :min="MIN_MCP_PORT"
              :max="MAX_MCP_PORT"
              step="1"
              :aria-label="t('settings.mcp.port')"
              @input="changePort"
              @keydown="handlePortKeydown"
            />
            <UiButton native
              class="secondary-button"
              type="button"
              :disabled="!canApplyPort"
              @click="applyPort"
            >
              {{ portState === 'saving' ? t('settings.mcp.moving') : t('settings.mcp.applyPort') }}
            </UiButton>
          </div>
          <output
            class="mcp-port-status"
            :class="portState"
            aria-live="polite"
          >{{ portMessage || t('runtimeActions.mcp.endpoint', { url: endpoint }) }}</output>
        </div>
      </div>
    </div>
    <div class="settings-info" :class="{ 'security-warning': !settings.mcpAuthentication }">
      <span class="info-dot" aria-hidden="true">
        <IconInfo v-if="settings.mcpAuthentication" />
        <IconWarning v-else />
      </span>
      <p v-if="settings.mcpAuthentication">{{ t('settings.mcp.tokenHelp') }}</p>
      <p v-else>{{ t('settings.mcp.warning') }}</p>
    </div>
  </div>
</template>
