<script setup lang="ts">
import { UiButton, UiCheckbox } from '../ui/index.js'
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { MAX_MCP_PORT, MIN_MCP_PORT } from '../../../shared/mcp-port'
import { isMcpToolSet } from '../../../shared/mcp-tool-sets'
import type { McpSettingsController } from '../composables/useMcpSettingsController'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import type { McpCapabilityProfilePreset } from '../../../shared/types'

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
  applyPort,
  capabilityProfiles,
  capabilityCredential,
  capabilityError,
  capabilityBusy,
  loadCapabilityProfiles,
  createCapabilityProfile,
  rotateCapabilityProfile,
  revokeCapabilityProfile,
  clearCapabilityCredential
} = props.controller

const profileName = ref('')
const profilePreset = ref<McpCapabilityProfilePreset>('read-only')
const profileParentId = ref('')
const profileWorkspaceIds = ref('')
const profileOrigins = ref('')
const profileExpiry = ref('1440')
const profileSingleUse = ref(false)

function lines(value: string): string[] | undefined {
  const entries = value.split(/[\n,]/u).map(entry => entry.trim()).filter(Boolean)
  return entries.length ? entries : undefined
}

async function submitCapabilityProfile(): Promise<void> {
  const expiresInMinutes = profileExpiry.value ? Number(profileExpiry.value) : undefined
  if (await createCapabilityProfile({
    name: profileName.value,
    preset: profilePreset.value,
    ...(profileParentId.value ? { parentProfileId: profileParentId.value } : {}),
    workspaceIds: lines(profileWorkspaceIds.value),
    origins: lines(profileOrigins.value),
    expiresInMinutes,
    singleUse: profileSingleUse.value
  })) profileName.value = ''
}

async function copyCapabilityCredential(): Promise<void> {
  if (capabilityCredential.value) await window.hronaut.copyText(capabilityCredential.value)
}

async function revokeProfile(id: string, name: string): Promise<void> {
  if (window.confirm(t('settings.mcp.capabilities.revokeConfirm', { name }))) await revokeCapabilityProfile(id)
}

onMounted(() => { void loadCapabilityProfiles() })
onUnmounted(clearCapabilityCredential)

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
  <div class="settings-content" :aria-busy="busy || capabilityBusy">
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
        <UiCheckbox
          bare
          id="setting-mcp-authentication"
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
            <UiButton
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
    <section class="mcp-capabilities">
      <div class="setting-copy">
        <h3>{{ t('settings.mcp.capabilities.heading') }}</h3>
        <p>{{ t('settings.mcp.capabilities.description') }}</p>
      </div>
      <form class="mcp-capability-form" @submit.prevent="submitCapabilityProfile">
        <label>
          <strong>{{ t('settings.mcp.capabilities.name') }}</strong>
          <input v-model="profileName" required maxlength="80" :disabled="capabilityBusy">
        </label>
        <label>
          <strong>{{ t('settings.mcp.capabilities.preset') }}</strong>
          <select v-model="profilePreset" :disabled="capabilityBusy">
            <option value="read-only">{{ t('settings.mcp.capabilities.presetReadOnly') }}</option>
            <option value="essentials">{{ t('settings.mcp.capabilities.presetEssentials') }}</option>
            <option value="qa">{{ t('settings.mcp.capabilities.presetQa') }}</option>
            <option value="complete">{{ t('settings.mcp.capabilities.presetComplete') }}</option>
          </select>
        </label>
        <label>
          <strong>{{ t('settings.mcp.capabilities.parent') }}</strong>
          <select v-model="profileParentId" :aria-label="t('settings.mcp.capabilities.parent')" :disabled="capabilityBusy">
            <option value="">{{ t('settings.mcp.capabilities.parentRoot') }}</option>
            <option
              v-for="profile in capabilityProfiles.filter(candidate => candidate.lineageActive)"
              :key="profile.id"
              :value="profile.id"
            >{{ t('settings.mcp.capabilities.parentOption', { name: profile.name, revision: profile.revision }) }}</option>
          </select>
          <small>{{ t('settings.mcp.capabilities.parentDescription') }}</small>
        </label>
        <label>
          <strong>{{ t('settings.mcp.capabilities.workspaces') }}</strong>
          <textarea v-model="profileWorkspaceIds" rows="2" :placeholder="t('settings.mcp.capabilities.workspacesPlaceholder')" :disabled="capabilityBusy" />
        </label>
        <label>
          <strong>{{ t('settings.mcp.capabilities.origins') }}</strong>
          <textarea v-model="profileOrigins" rows="2" :placeholder="t('settings.mcp.capabilities.originsPlaceholder')" :disabled="capabilityBusy" />
        </label>
        <label>
          <strong>{{ t('settings.mcp.capabilities.expiry') }}</strong>
          <select v-model="profileExpiry" :disabled="capabilityBusy">
            <option value="60">{{ t('settings.mcp.capabilities.oneHour') }}</option>
            <option value="1440">{{ t('settings.mcp.capabilities.oneDay') }}</option>
            <option value="10080">{{ t('settings.mcp.capabilities.sevenDays') }}</option>
            <option value="">{{ t('settings.mcp.capabilities.noExpiry') }}</option>
          </select>
        </label>
        <label class="mcp-capability-check">
          <input v-model="profileSingleUse" type="checkbox" :disabled="capabilityBusy">
          <span>{{ t('settings.mcp.capabilities.singleUse') }}</span>
        </label>
        <UiButton variant="primary" type="submit" :disabled="capabilityBusy || !profileName.trim()">
          {{ capabilityBusy ? t('settings.mcp.capabilities.saving') : t('settings.mcp.capabilities.create') }}
        </UiButton>
      </form>
      <div v-if="capabilityCredential" class="mcp-capability-secret" role="status">
        <strong>{{ t('settings.mcp.capabilities.credentialHeading') }}</strong>
        <p>{{ t('settings.mcp.capabilities.credentialWarning') }}</p>
        <code>{{ capabilityCredential }}</code>
        <div>
          <UiButton type="button" @click="copyCapabilityCredential">{{ t('settings.mcp.capabilities.copy') }}</UiButton>
          <UiButton type="button" @click="clearCapabilityCredential">{{ t('settings.mcp.capabilities.dismiss') }}</UiButton>
        </div>
      </div>
      <div v-if="capabilityProfiles.length" class="mcp-capability-list">
        <article v-for="profile in capabilityProfiles" :key="profile.id" class="mcp-capability-card">
          <div>
            <strong>{{ profile.name }}</strong>
            <small>{{ t('settings.mcp.capabilities.profileSummary', { revision: profile.revision, tools: profile.allowedTools.length, uses: profile.useCount, limit: profile.maxUses ?? '∞' }) }}</small>
            <small v-if="profile.parentAuthorization">{{ t('settings.mcp.capabilities.derivedFrom', {
              name: capabilityProfiles.find(candidate => candidate.id === profile.parentAuthorization?.profileId)?.name ?? profile.parentAuthorization.profileId,
              revision: profile.parentAuthorization.revision
            }) }}</small>
            <small v-if="profile.revokedAt" class="mcp-capability-revoked">{{ t('settings.mcp.capabilities.revoked') }}</small>
            <small v-else-if="!profile.lineageActive" class="mcp-capability-revoked">{{ t('settings.mcp.capabilities.inactiveLineage') }}</small>
            <small v-else-if="profile.expiresAt">{{ t('settings.mcp.capabilities.expires', { date: new Date(profile.expiresAt).toLocaleString() }) }}</small>
          </div>
          <div class="mcp-capability-actions">
            <UiButton type="button" :disabled="capabilityBusy || !profile.lineageActive" @click="rotateCapabilityProfile(profile.id)">{{ t('settings.mcp.capabilities.rotate') }}</UiButton>
            <UiButton variant="danger" type="button" :disabled="capabilityBusy || !!profile.revokedAt" @click="revokeProfile(profile.id, profile.name)">{{ t('settings.mcp.capabilities.revoke') }}</UiButton>
          </div>
          <details>
            <summary>{{ t('settings.mcp.capabilities.inspect') }}</summary>
            <code>{{ profile.allowedTools.join(', ') }}</code>
            <small v-if="profile.workspaceIds?.length">{{ profile.workspaceIds.join(', ') }}</small>
            <small v-if="profile.origins?.length">{{ profile.origins.join(', ') }}</small>
          </details>
        </article>
      </div>
      <p v-else class="mcp-capability-empty">{{ t('settings.mcp.capabilities.empty') }}</p>
      <output v-if="capabilityError" class="site-controls-error" role="alert">{{ capabilityError }}</output>
    </section>
  </div>
</template>
