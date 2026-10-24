<script setup lang="ts">
import { UiButton, UiCheckbox } from '../ui/index.js'
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime } from '../../../shared/format'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { MAX_MCP_PORT, MIN_MCP_PORT } from '../../../shared/mcp-port'
import { isMcpToolSet } from '../../../shared/mcp-tool-sets'
import type { McpSettingsController } from '../composables/useMcpSettingsController'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import { confirmAction } from '../confirm-action.js'
import { splitConfirmation } from '../../../shared/confirmation.js'
import { ignoreHeldEnter } from '../held-enter.js'
import IconAdd from '~icons/material-symbols/add-rounded'
import type { McpCapabilityProfilePreset, SupportedLocale } from '../../../shared/types'

const props = defineProps<{
  controller: McpSettingsController
}>()

const { t, locale } = useI18n({ useScope: 'global' })
// Dates follow Hronaut's interface language, not the system's.
const localDateTime = (value: number | string): string => formatDateTime(locale.value as SupportedLocale, value, { dateStyle: 'medium', timeStyle: 'medium' })
const {
  settings,
  endpoint,
  portDraft,
  portState,
  portMessage,
  busy,
  canApplyPort,
  editPort,
  setRemoteAccess,
  setAuthentication,
  setChallengeDetectionEnabled,
  setOmitAgentUrlDetail,
  setToolSet,
  applyPort,
  applySuggestedPort,
  suggestedPort,
  listenerProblem,
  capabilityProfiles,
  capabilityCredential,
  capabilityError,
  capabilityBusy,
  capabilityCopied,
  loadCapabilityProfiles,
  createCapabilityProfile,
  rotateCapabilityProfile,
  revokeCapabilityProfile,
  copyCapabilityCredential,
  clearCapabilityCredential,
  clearCapabilityError
} = props.controller

const portInput = ref<HTMLInputElement | null>(null)
/** After a move the offer disappears with its button, so focus goes back to the port field. */
async function useSuggestedPort(): Promise<void> {
  if (!(await applySuggestedPort())) return
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) portInput.value?.focus()
}

const profileName = ref('')
const profilePreset = ref<McpCapabilityProfilePreset>('read-only')
const profileParentId = ref('')
const profileWorkspaceIds = ref('')
const profileOrigins = ref('')
const profileArguments = ref('')
const profileExpiry = ref('1440')
const profileSingleUse = ref(false)

async function changeRemoteAccess(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setRemoteAccess(input.checked))) input.checked = settings.value.mcpRemoteAccess
}

function lines(value: string): string[] | undefined {
  const entries = value.split(/[\n,]/u).map(entry => entry.trim()).filter(Boolean)
  return entries.length ? entries : undefined
}

function argumentConstraints(value: string): Record<string, unknown[]> | undefined {
  const result = new Map<string, unknown[]>()
  for (const line of value.split(/\r?\n/u).map(entry => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf('=')
    if (separator <= 0) return { '': [] }
    const path = line.slice(0, separator).trim()
    const serialized = line.slice(separator + 1).trim()
    let parsed: unknown = serialized
    if (serialized) {
      try { parsed = JSON.parse(serialized) } catch { /* Treat unquoted text as an exact string. */ }
    }
    const values = result.get(path) ?? []
    values.push(parsed)
    result.set(path, values)
  }
  return result.size ? Object.fromEntries(result) : undefined
}

// The form for a new profile stays closed until asked for, so MCP security opens on the profiles there are.
const profileFormOpen = ref(false)
const profileForm = ref<HTMLFormElement | null>(null)
const capabilitySection = ref<HTMLElement | null>(null)
/** The error a failed Create showed, which closing the form takes away with it. */
let profileFormError = ''

function formHasFocus(): boolean {
  return !!profileForm.value?.contains(document.activeElement)
}

/** Whether the focus went nowhere, as when the control that had it was disabled or removed. */
function focusLost(): boolean {
  return !document.activeElement || document.activeElement === document.body
}

async function openProfileForm(): Promise<void> {
  profileFormOpen.value = true
  await nextTick()
  profileForm.value?.querySelector<HTMLInputElement>('input')?.focus()
}

/**
 * Closes the form and empties it, along with the error its last Create showed. When the form had the focus and
 * nothing else took it meanwhile, the focus goes to the credential the form just created, or else back to New
 * capability profile, which ignores a held Enter so the key that closed the form does not open it again.
 */
async function closeProfileForm(hadFocus = formHasFocus(), focusTarget: 'credential' | 'new' = 'new'): Promise<void> {
  if (profileFormError) clearCapabilityError(profileFormError)
  profileFormError = ''
  profileFormOpen.value = false
  profileName.value = ''
  profilePreset.value = 'read-only'
  profileParentId.value = ''
  profileWorkspaceIds.value = ''
  profileOrigins.value = ''
  profileArguments.value = ''
  profileExpiry.value = '1440'
  profileSingleUse.value = false
  await nextTick()
  if (!hadFocus || !focusLost()) return
  capabilitySection.value?.querySelector<HTMLElement>(focusTarget === 'credential' ? '.mcp-capability-secret' : '.mcp-capability-new')?.focus()
}

async function submitCapabilityProfile(): Promise<void> {
  // Saving disables the form, which takes the focus away from it, so whether it had the focus is read first.
  const hadFocus = formHasFocus()
  const credentialBefore = capabilityCredential.value
  const expiresInMinutes = profileExpiry.value ? Number(profileExpiry.value) : undefined
  const constraints = argumentConstraints(profileArguments.value)
  const created = await createCapabilityProfile({
    name: profileName.value,
    preset: profilePreset.value,
    ...(profileParentId.value ? { parentProfileId: profileParentId.value } : {}),
    workspaceIds: lines(profileWorkspaceIds.value),
    origins: lines(profileOrigins.value),
    ...(constraints ? { argumentConstraints: constraints } : {}),
    expiresInMinutes,
    singleUse: profileSingleUse.value
  })
  if (created) {
    // A credential shown before this Create, as after a Rotate, is not the one to focus.
    const credentialShown = !!capabilityCredential.value && capabilityCredential.value !== credentialBefore
    await closeProfileForm(hadFocus, credentialShown ? 'credential' : 'new')
    return
  }
  profileFormError = capabilityError.value
  await nextTick()
  // The form stays open to be corrected, with the focus back in it instead of on the page.
  if (hadFocus && focusLost()) profileForm.value?.querySelector<HTMLInputElement>('input')?.focus()
}

/** Dismisses the credential; the focus that was on it moves to New capability profile, or into the open form. */
async function dismissCredential(): Promise<void> {
  const hadFocus = !!capabilitySection.value?.querySelector('.mcp-capability-secret')?.contains(document.activeElement)
  clearCapabilityCredential()
  await nextTick()
  if (!hadFocus || !focusLost()) return
  capabilitySection.value?.querySelector<HTMLElement>('.mcp-capability-new, .mcp-capability-form input')?.focus()
}

async function revokeProfile(id: string, name: string): Promise<void> {
  if (await confirmAction(splitConfirmation((parameters) => t('settings.mcp.capabilities.revokeConfirm', parameters), { name }))) await revokeCapabilityProfile(id)
}

onMounted(() => { void loadCapabilityProfiles() })
onUnmounted(clearCapabilityCredential)

async function changeAuthentication(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setAuthentication(input.checked))) input.checked = settings.value.mcpAuthentication
}

async function changeChallengeDetection(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setChallengeDetectionEnabled(input.checked))) input.checked = settings.value.challengeDetectionEnabled
}

async function changeOmitUrlDetail(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setOmitAgentUrlDetail(input.checked))) input.checked = settings.value.omitAgentUrlDetail
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
      <label class="settings-row" for="setting-mcp-remote-access">
        <span>
          <strong>{{ t('settings.mcp.remote.label') }}</strong>
          <small>{{ t('settings.mcp.remote.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-mcp-remote-access" :checked="settings.mcpRemoteAccess"
          :disabled="busy" @change="changeRemoteAccess" />
      </label>
      <p class="settings-info">{{ t('settings.mcp.remote.restart') }}</p>
      <p v-if="settings.mcpRemoteAccess" class="settings-info">
        {{ t('settings.mcp.remote.connection', { port: settings.mcpPort }) }}
      </p>
      <label class="settings-row" for="setting-mcp-authentication">
        <span>
          <strong>{{ t('settings.mcp.require') }}</strong>
          <small>{{ t('settings.mcp.requireDescription') }}</small>
        </span>
        <UiCheckbox
          bare
          appearance="switch"
          id="setting-mcp-authentication"
          :checked="settings.mcpAuthentication"
          :disabled="busy"
          @change="changeAuthentication"
        />
      </label>
      <label class="settings-row" for="setting-challenge-detection">
        <span>
          <strong>{{ t('settings.mcp.challengeDetection') }}</strong>
          <small>{{ t('settings.mcp.challengeDetectionDescription') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-challenge-detection" :checked="settings.challengeDetectionEnabled"
          :disabled="busy" @change="changeChallengeDetection" />
      </label>
      <label class="settings-row" for="setting-omit-url-detail">
        <span>
          <strong>{{ t('settings.mcp.omitUrlDetail') }}</strong>
          <small>{{ t('settings.mcp.omitUrlDetailDescription') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-omit-url-detail" :checked="settings.omitAgentUrlDetail"
          :disabled="busy" @change="changeOmitUrlDetail" />
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
              ref="portInput"
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
          <div v-if="listenerProblem" class="mcp-port-problem" role="alert">
            <span>{{ listenerProblem }} {{ suggestedPort ? t('runtime.mcp.portNote') : t('runtime.mcp.portNoneFree') }}</span>
            <UiButton v-if="suggestedPort" size="small" variant="primary" :disabled="busy" @click="useSuggestedPort">{{ t('runtime.mcp.usePort', { port: suggestedPort }) }}</UiButton>
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
    <section ref="capabilitySection" class="mcp-capabilities">
      <div class="setting-copy">
        <h3>{{ t('settings.mcp.capabilities.heading') }}</h3>
        <p>{{ t('settings.mcp.capabilities.description') }}</p>
      </div>
      <div v-if="capabilityCredential" class="mcp-capability-secret" role="status" tabindex="-1" aria-atomic="false" aria-labelledby="mcp-capability-credential-heading">
        <strong id="mcp-capability-credential-heading">{{ t('settings.mcp.capabilities.credentialHeading') }}</strong>
        <p>{{ t('settings.mcp.capabilities.credentialWarning') }}</p>
        <code>{{ capabilityCredential }}</code>
        <div>
          <UiButton type="button" @click="copyCapabilityCredential">{{ capabilityCopied ? t('settings.mcp.capabilities.copied') : t('settings.mcp.capabilities.copy') }}</UiButton>
          <UiButton type="button" @click="dismissCredential">{{ t('settings.mcp.capabilities.dismiss') }}</UiButton>
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
            <small v-else-if="profile.expiresAt">{{ t('settings.mcp.capabilities.expires', { date: localDateTime(profile.expiresAt) }) }}</small>
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
            <small v-if="profile.argumentValueDigests && Object.keys(profile.argumentValueDigests).length">{{ t('settings.mcp.capabilities.argumentScope', { paths: Object.keys(profile.argumentValueDigests).join(', ') }) }}</small>
          </details>
        </article>
      </div>
      <p v-else class="mcp-capability-empty">{{ t('settings.mcp.capabilities.empty') }}</p>
      <form v-if="profileFormOpen" ref="profileForm" class="mcp-capability-form" :aria-label="t('settings.mcp.capabilities.newProfile')" @submit.prevent="submitCapabilityProfile">
        <label>
          <strong>{{ t('settings.mcp.capabilities.name') }}</strong>
          <input v-model="profileName" required maxlength="80" :disabled="capabilityBusy" @keydown="ignoreHeldEnter">
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
          <strong>{{ t('settings.mcp.capabilities.arguments') }}</strong>
          <textarea v-model="profileArguments" rows="3" maxlength="65536" :aria-label="t('settings.mcp.capabilities.arguments')" :placeholder="t('settings.mcp.capabilities.argumentsPlaceholder')" :disabled="capabilityBusy" />
          <small>{{ t('settings.mcp.capabilities.argumentsDescription') }}</small>
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
        <div class="mcp-capability-form-actions">
          <UiButton type="button" :disabled="capabilityBusy" @click="closeProfileForm()">{{ t('settings.mcp.capabilities.cancel') }}</UiButton>
          <UiButton variant="primary" type="submit" :disabled="capabilityBusy || !profileName.trim()">
            {{ capabilityBusy ? t('settings.mcp.capabilities.saving') : t('settings.mcp.capabilities.create') }}
          </UiButton>
        </div>
      </form>
      <UiButton v-else class="mcp-capability-new" type="button" :disabled="capabilityBusy" @keydown="ignoreHeldEnter" @click="openProfileForm"><IconAdd aria-hidden="true" />{{ t('settings.mcp.capabilities.newProfile') }}</UiButton>
      <output v-if="capabilityError" class="site-controls-error" role="alert">{{ capabilityError }}</output>
    </section>
  </div>
</template>
