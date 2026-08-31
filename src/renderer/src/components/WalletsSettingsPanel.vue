<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WalletsController } from '../composables/useWalletsController.js'
import WalletNetworkFields from './WalletNetworkFields.vue'
import {
  WalletNetworkSchema,
  walletNetworkValidationIssue,
  type WalletChainFamily,
  type WalletNetwork,
  type WalletPolicy,
  type WalletSecretFormat
} from '../../../shared/wallet.js'
import {
  DEFAULT_WALLET_NETWORK_PRESET,
  walletNetworkPreset
} from '../../../shared/wallet-network-presets.js'

const props = defineProps<{
  controller: WalletsController
  workspaces: Array<{ id: string; name: string }>
}>()
const { t } = useI18n({ useScope: 'global' })

const mode = ref<'generate' | 'import' | 'watch'>('generate')
const walletModes = ['generate', 'import', 'watch'] as const
const selectedWalletId = ref('')
const renamingWallet = ref(false)
const renameDraft = ref('')
const editingRpc = ref(false)
const rpcDraft = ref('')
const name = ref('')
const chainFamily = ref<WalletChainFamily>('evm')
const networkPresetId = ref(DEFAULT_WALLET_NETWORK_PRESET.evm)
const networkDraft = ref<WalletNetwork>({ ...walletNetworkPreset(networkPresetId.value)!.network })
const onboardingWorkspaceIds = ref<string[]>([])
const configuredWorkspaceIds = ref<string[]>([])
const onboardingWorkspaceScope = ref<'selected' | 'all'>('selected')
const configuredWorkspaceScope = ref<'selected' | 'all'>('selected')
const watchAddress = ref('')
const secretFormat = ref<WalletSecretFormat>('mnemonic')
const recoveryInput = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const passphraseInput = ref<HTMLInputElement | null>(null)
const preparedImport = ref<{
  token: string
  publicAddress: string
  details: {
    name: string
    network: WalletNetwork
    workspaceIds: string[]
    availableInAllWorkspaces: boolean
    dedicatedAgent: boolean
  }
} | null>(null)
const policyOrigin = ref('')
const policyWorkspaceId = ref('')
const policyDestination = ref('')
const policyMethod = ref('')
const policyMaxAmount = ref('')
const policyMaxTokenAmount = ref('')
const policyMaxFee = ref('')
const policySessionLimit = ref('')
const policyDailyLimit = ref('')
const policyMaximumOperations = ref(1)
const policyExpiry = ref('')
const dedicatedAgent = ref(false)
const policyBypassApprove = ref(false)
const vaultUsesPassphrase = computed(() => ['passphrase', 'basic_text', 'unknown'].includes(
  props.controller.status.value.backend
))

const selectedWallet = computed(() => props.controller.wallets.value.find((wallet) => wallet.id === selectedWalletId.value))
const selectedPolicies = computed(() => props.controller.policies.value.filter((policy) => policy.walletId === selectedWalletId.value))
const selectedPermissions = computed(() => props.controller.permissions.value.filter((permission) => permission.walletId === selectedWalletId.value))
const configuredRpcLabel = computed(() => selectedWallet.value?.chainFamily === 'solana'
  ? t('wallets.solanaRpcUrl')
  : selectedWallet.value?.chainFamily === 'tron'
    ? t('wallets.tronRpcUrl')
    : t('wallets.evmRpcUrl'))
const configuredRpcValid = computed(() => WalletNetworkSchema.shape.rpcUrl.safeParse(rpcDraft.value.trim()).success)
const onboardingNetworkValid = computed(() => {
  const candidate = network()
  return WalletNetworkSchema.safeParse(candidate).success
    && walletNetworkValidationIssue(chainFamily.value, candidate) === null
})
const policyWorkspaceOptions = computed(() => {
  if (selectedWallet.value?.availableInAllWorkspaces) return props.workspaces
  const attached = new Set(selectedWallet.value?.workspaceIds ?? [])
  return props.workspaces.filter((workspace) => attached.has(workspace.id))
})
const policyOriginValid = computed(() => {
  const value = policyOrigin.value.trim()
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && value === url.origin
  } catch {
    return false
  }
})
const optionalPolicyAmountsValid = computed(() => [
  policyMaxAmount.value,
  policyMaxTokenAmount.value,
  policyMaxFee.value,
  policySessionLimit.value,
  policyDailyLimit.value
].every((value) => !value || /^\d+(?:\.\d+)?$/.test(value)))
const selectedWalletIsMainnet = computed(() => selectedWallet.value?.network.environment === 'mainnet')
const mainnetBypassSupported = computed(() => (
  selectedWalletIsMainnet.value
  && selectedWallet.value?.chainFamily === 'evm'
  && selectedWallet.value?.kind === 'agent'
))
const mainnetBypassLimitsValid = computed(() => {
  const expiresAt = Date.parse(policyExpiry.value)
  return [
    policyMaxAmount.value,
    policyMaxTokenAmount.value,
    policyMaxFee.value,
    policySessionLimit.value,
    policyDailyLimit.value
  ].every((value) => /^\d+(?:\.\d+)?$/.test(value))
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && expiresAt <= Date.now() + 7 * 24 * 60 * 60_000
    && policyMaximumOperations.value <= 100
})
const canAddBoundedPolicy = computed(() => (
  policyWorkspaceOptions.value.some((workspace) => workspace.id === policyWorkspaceId.value)
  && policyOriginValid.value
  && policyDestination.value.trim().length > 0
  && policyMethod.value.trim().length > 0
  && optionalPolicyAmountsValid.value
  && Number.isInteger(policyMaximumOperations.value)
  && policyMaximumOperations.value > 0
  && policyMaximumOperations.value <= 1_000_000
  && (!policyExpiry.value || Date.parse(policyExpiry.value) > Date.now())
  && (!selectedWalletIsMainnet.value || (
    mainnetBypassSupported.value
    && policyBypassApprove.value
    && mainnetBypassLimitsValid.value
  ))
))
const backendTranslationKeys: Record<string, string> = {
  'safe-storage': 'safeStorage',
  keychain: 'keychain',
  dpapi: 'dpapi',
  gnome_libsecret: 'libsecret',
  kwallet: 'kwallet',
  kwallet5: 'kwallet',
  kwallet6: 'kwallet',
  passphrase: 'passphrase',
  basic_text: 'passphrase',
  unknown: 'passphrase',
  unavailable: 'unavailable',
  error: 'unavailable',
  'integrity-failure': 'unavailable',
  'secure-storage-failure': 'unavailable',
  'initialization-failure': 'unavailable',
  initializing: 'initializing',
  uninitialized: 'initializing'
}
const statusCopy = computed(() => {
  const service = props.controller.status.value
  const status = t(`wallets.statuses.${service.managedWallets}`)
  const backend = t(`wallets.backends.${backendTranslationKeys[service.backend] ?? 'unavailable'}`)
  return service.managedWallets === 'disabled' && service.reason
    ? t('wallets.statusWithReason', { status, backend, reason: service.reason })
    : t('wallets.status', { status, backend })
})

watch(() => props.controller.wallets.value, (wallets) => {
  if (!wallets.some((wallet) => wallet.id === selectedWalletId.value)) selectedWalletId.value = wallets[0]?.id ?? ''
}, { immediate: true })

watch(selectedWallet, (wallet) => {
  configuredWorkspaceIds.value = wallet ? [...wallet.workspaceIds] : []
  configuredWorkspaceScope.value = wallet?.availableInAllWorkspaces ? 'all' : 'selected'
  policyWorkspaceId.value = wallet?.availableInAllWorkspaces
    ? (props.workspaces[0]?.id ?? '')
    : (wallet?.workspaceIds[0] ?? '')
  renamingWallet.value = false
  renameDraft.value = wallet?.name ?? ''
  editingRpc.value = false
  rpcDraft.value = wallet?.network.rpcUrl ?? ''
  policyBypassApprove.value = false
}, { immediate: true })

watch(secretFormat, () => {
  if (recoveryInput.value) recoveryInput.value.value = ''
})

watch(chainFamily, (family) => {
  const nextPresetId = DEFAULT_WALLET_NETWORK_PRESET[family]
  const nextPreset = walletNetworkPreset(nextPresetId)
  if (!nextPreset) return
  networkPresetId.value = nextPresetId
  networkDraft.value = { ...nextPreset.network }
})

function network(): WalletNetwork {
  return {
    id: networkDraft.value.id.trim(),
    name: networkDraft.value.name.trim(),
    environment: networkDraft.value.environment,
    rpcUrl: networkDraft.value.rpcUrl.trim()
  }
}

async function submitOnboarding(): Promise<void> {
  const availableInAllWorkspaces = onboardingWorkspaceScope.value === 'all'
  const input = {
    name: name.value.trim(),
    chainFamily: chainFamily.value,
    network: network(),
    workspaceIds: availableInAllWorkspaces ? [] : [...onboardingWorkspaceIds.value],
    availableInAllWorkspaces
  }
  if (mode.value === 'generate') {
    await props.controller.generate({ ...input, dedicatedAgent: dedicatedAgent.value })
  } else if (mode.value === 'watch') {
    await props.controller.addWatchOnly({ ...input, publicAddress: watchAddress.value.trim() })
  } else {
    const secret = recoveryInput.value?.value ?? ''
    if (recoveryInput.value) recoveryInput.value.value = ''
    const prepared = await props.controller.prepareImport(chainFamily.value, secretFormat.value, secret)
    if (prepared) {
      preparedImport.value = {
        token: prepared.token,
        publicAddress: prepared.publicAddress,
        details: {
          name: input.name,
          network: { ...input.network },
          workspaceIds: [...input.workspaceIds],
          availableInAllWorkspaces: input.availableInAllWorkspaces,
          dedicatedAgent: dedicatedAgent.value
        }
      }
    }
  }
}

async function confirmPreparedImport(): Promise<void> {
  if (!preparedImport.value) return
  const confirmed = await props.controller.confirmImport(preparedImport.value.token, preparedImport.value.details)
  if (confirmed) preparedImport.value = null
}

async function cancelPreparedImport(): Promise<void> {
  if (!preparedImport.value) return
  await props.controller.cancelImport(preparedImport.value.token)
  preparedImport.value = null
}

async function submitPassphrase(action: 'setup' | 'unlock'): Promise<void> {
  const passphrase = passphraseInput.value?.value ?? ''
  if (passphraseInput.value) passphraseInput.value.value = ''
  if (action === 'setup') await props.controller.setupPassphrase(passphrase)
  else await props.controller.unlock(passphrase)
}

async function unlockSystemStorage(): Promise<void> {
  await props.controller.unlock('')
}

async function attachWorkspaces(): Promise<void> {
  if (!selectedWallet.value) return
  const availableInAllWorkspaces = configuredWorkspaceScope.value === 'all'
  await props.controller.update(selectedWallet.value.id, {
    workspaceIds: availableInAllWorkspaces ? [] : [...configuredWorkspaceIds.value],
    availableInAllWorkspaces
  })
}

function renameWallet(): void {
  const wallet = selectedWallet.value
  if (!wallet) return
  renameDraft.value = wallet.name
  renamingWallet.value = true
}

async function saveWalletName(): Promise<void> {
  const wallet = selectedWallet.value
  const next = renameDraft.value.trim()
  if (!wallet || !next) return
  await props.controller.update(wallet.id, { name: next })
  renamingWallet.value = false
}

function cancelWalletRename(): void {
  renamingWallet.value = false
  renameDraft.value = selectedWallet.value?.name ?? ''
}

function editWalletRpc(): void {
  const wallet = selectedWallet.value
  if (!wallet) return
  rpcDraft.value = wallet.network.rpcUrl
  editingRpc.value = true
}

async function saveWalletRpc(): Promise<void> {
  const wallet = selectedWallet.value
  const rpcUrl = rpcDraft.value.trim()
  if (!wallet || !configuredRpcValid.value || rpcUrl === wallet.network.rpcUrl) return
  await props.controller.update(wallet.id, { rpcUrl })
  editingRpc.value = false
}

function cancelWalletRpcEdit(): void {
  editingRpc.value = false
  rpcDraft.value = selectedWallet.value?.network.rpcUrl ?? ''
}

async function removeWallet(): Promise<void> {
  const wallet = selectedWallet.value
  if (wallet && window.confirm(t('wallets.removeConfirm', { name: wallet.name }))) await props.controller.remove(wallet.id)
}

async function addPolicy(): Promise<void> {
  const wallet = selectedWallet.value
  if (!wallet) return
  const expiry = policyExpiry.value ? new Date(policyExpiry.value).toISOString() : new Date(Date.now() + 60 * 60_000).toISOString()
  const policy: WalletPolicy = {
    id: crypto.randomUUID(), name: t('wallets.policyName', { network: wallet.network.name }), mode: 'bounded-auto', walletId: wallet.id,
    workspaceId: policyWorkspaceId.value, networkIds: [wallet.network.id],
    origins: [policyOrigin.value.trim()], destinations: [policyDestination.value.trim()], methods: [policyMethod.value.trim()],
    ...(policyMaxAmount.value ? { maxNativeAmount: policyMaxAmount.value } : {}),
    ...(policyMaxTokenAmount.value ? { maxTokenAmount: policyMaxTokenAmount.value } : {}),
    ...(policyMaxFee.value ? { maxFee: policyMaxFee.value } : {}),
    ...(policySessionLimit.value ? { sessionSpendLimit: policySessionLimit.value } : {}),
    ...(policyDailyLimit.value ? { dailySpendLimit: policyDailyLimit.value } : {}),
    expiresAt: expiry, maximumOperationCount: policyMaximumOperations.value,
    requireSuccessfulSimulation: true, allowMessageSigning: false,
    ...(policyBypassApprove.value ? { allowMainnetAgentAutomation: true } : {})
  }
  await props.controller.setPolicy(policy)
}
</script>

<template>
  <div class="settings-content wallet-settings">
    <div class="setting-copy">
      <h3>{{ t('wallets.heading') }}</h3>
      <p>{{ t('wallets.description') }}</p>
    </div>

    <div class="settings-info" :class="{ 'security-warning': controller.status.value.managedWallets === 'disabled' }">
      <span class="info-dot" aria-hidden="true">{{ t('common.hronaut').slice(0, 1) }}</span>
      <p>{{ statusCopy }}</p>
    </div>

    <form v-if="controller.status.value.managedWallets === 'passphrase-setup-required'" class="wallet-card" @submit.prevent="submitPassphrase('setup')">
      <h4>{{ t('wallets.createPassphrase') }}</h4>
      <p>{{ t('wallets.createPassphraseDescription') }}</p>
      <label>{{ t('wallets.createPassphrase') }} <input ref="passphraseInput" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label>
      <button class="primary-button" type="submit" :disabled="controller.busy.value">{{ t('wallets.createEncryptedVault') }}</button>
    </form>
    <form v-else-if="controller.status.value.managedWallets === 'locked' && vaultUsesPassphrase" class="wallet-card wallet-unlock-card" @submit.prevent="submitPassphrase('unlock')">
      <div><h4>{{ t('wallets.unlockVault') }}</h4><p>{{ t('wallets.unlockPassphraseDescription') }}</p></div>
      <label>{{ t('wallets.vaultPassphrase') }} <input ref="passphraseInput" type="password" minlength="12" maxlength="1024" autocomplete="current-password" required></label>
      <button class="primary-button" type="submit" :disabled="controller.busy.value">{{ t('wallets.unlock') }}</button>
    </form>
    <section v-else-if="controller.status.value.managedWallets === 'locked'" class="wallet-card wallet-unlock-card">
      <div><h4>{{ t('wallets.signingLocked') }}</h4><p>{{ t('wallets.signingLockedDescription') }}</p></div>
      <button class="primary-button" type="button" :disabled="controller.busy.value" @click="unlockSystemStorage">{{ t('wallets.unlockSystemStorage') }}</button>
    </section>

    <section class="wallet-card">
      <div class="wallet-card-heading"><h4>{{ t('wallets.addWallet') }}</h4><span>{{ t('wallets.secretsNotCopied') }}</span></div>
      <div class="wallet-mode-tabs" role="group" :aria-label="t('wallets.walletType')">
        <button v-for="entry in walletModes" :key="entry" type="button" :class="{ active: mode === entry }" :aria-pressed="mode === entry" :disabled="preparedImport !== null" @click="mode = entry">{{ t(`wallets.modes.${entry}`) }}</button>
      </div>
      <form class="wallet-form" @submit.prevent="submitOnboarding">
        <label>{{ t('wallets.name') }} <input v-model="name" maxlength="128" required :disabled="preparedImport !== null"></label>
        <label>{{ t('wallets.chain') }} <select v-model="chainFamily" :disabled="preparedImport !== null"><option value="evm">{{ t('wallets.chains.evm') }}</option><option value="solana">{{ t('wallets.chains.solana') }}</option><option value="tron">{{ t('wallets.chains.tron') }}</option></select></label>
        <WalletNetworkFields v-model="networkDraft" v-model:preset-id="networkPresetId" :chain-family="chainFamily" :disabled="preparedImport !== null" />
        <label v-if="mode === 'watch'" class="wallet-wide">{{ t('wallets.publicAddress') }} <input v-model="watchAddress" maxlength="256" required :disabled="preparedImport !== null"></label>
        <template v-if="mode === 'import'">
          <label>{{ t('wallets.secretFormat') }} <select v-model="secretFormat" :disabled="preparedImport !== null"><option value="mnemonic">{{ t('wallets.mnemonic') }}</option><option value="private-key">{{ t('wallets.privateKey') }}</option></select></label>
          <label v-if="secretFormat === 'mnemonic'" class="wallet-wide">{{ t('wallets.mnemonicInput') }} <textarea ref="recoveryInput" rows="3" required autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="preparedImport !== null"></textarea></label>
          <label v-else class="wallet-wide">{{ t('wallets.privateKey') }} <input ref="recoveryInput" type="password" required autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="preparedImport !== null"></label>
        </template>
        <label v-if="mode !== 'watch'" class="wallet-wide wallet-choice-card"><input v-model="dedicatedAgent" type="checkbox" :aria-label="t('wallets.dedicatedAgent')" :disabled="preparedImport !== null"><span><strong>{{ t('wallets.dedicatedAgent') }}</strong><small>{{ t('wallets.dedicatedAgentDescription') }}</small></span></label>
        <section class="wallet-wide wallet-access-panel" aria-labelledby="wallet-onboarding-access-heading">
          <div class="wallet-access-heading"><h5 id="wallet-onboarding-access-heading">{{ t('wallets.workspaceAccessHeading') }}</h5><p>{{ t('wallets.workspaceAccessDescription') }}</p></div>
          <div class="wallet-scope-options" role="radiogroup" :aria-label="t('wallets.workspaceAccessHeading')">
            <label class="wallet-choice-card"><input v-model="onboardingWorkspaceScope" type="radio" value="selected" :aria-label="t('wallets.selectedWorkspaces')" :disabled="preparedImport !== null"><span><strong>{{ t('wallets.selectedWorkspaces') }}</strong><small>{{ t('wallets.selectedWorkspacesDescription') }}</small></span></label>
            <label class="wallet-choice-card"><input v-model="onboardingWorkspaceScope" type="radio" value="all" :aria-label="t('wallets.anyWorkspace')" :disabled="preparedImport !== null"><span><strong>{{ t('wallets.anyWorkspace') }}</strong><small>{{ t('wallets.anyWorkspaceDescription') }}</small></span></label>
          </div>
          <fieldset :disabled="preparedImport !== null || onboardingWorkspaceScope === 'all'"><legend>{{ t('wallets.chooseWorkspaces') }}</legend><label v-for="workspace in workspaces" :key="workspace.id"><input v-model="onboardingWorkspaceIds" type="checkbox" :value="workspace.id"> {{ workspace.name }}</label><p v-if="workspaces.length === 0">{{ t('wallets.noWorkspaces') }}</p></fieldset>
        </section>
        <button class="primary-button" type="submit" :disabled="preparedImport !== null || controller.busy.value || !onboardingNetworkValid || (mode === 'watch' ? !controller.status.value.watchOnlyAvailable : controller.status.value.managedWallets !== 'ready')">{{ mode === 'import' ? t('wallets.validateImport') : t('wallets.addWallet') }}</button>
      </form>
      <div v-if="preparedImport" class="wallet-import-confirm">
        <strong>{{ t('wallets.confirmDerivedAddress') }}</strong><code>{{ preparedImport.publicAddress }}</code>
        <button class="primary-button" type="button" :disabled="controller.busy.value" @click="confirmPreparedImport">{{ t('wallets.confirmAndEncrypt') }}</button>
        <button class="secondary-button" type="button" :disabled="controller.busy.value" @click="cancelPreparedImport">{{ t('wallets.cancel') }}</button>
      </div>
    </section>

    <section class="wallet-card">
      <div class="wallet-card-heading"><h4>{{ t('wallets.configured') }}</h4></div>
      <div v-if="controller.status.value.managedWallets === 'ready'" class="wallet-vault-control">
        <div><strong>{{ t('wallets.signingVault') }}</strong><small>{{ t('wallets.lockVaultDescription') }}</small></div>
        <button class="secondary-button" type="button" :disabled="controller.busy.value" @click="controller.lock">{{ t('wallets.lockSigningKeys') }}</button>
      </div>
      <label class="wallet-selector-label">{{ t('wallets.configured') }}<select v-model="selectedWalletId" class="wallet-selector"><option value="" disabled>{{ t('wallets.selectWallet') }}</option><option v-for="wallet in controller.wallets.value" :key="wallet.id" :value="wallet.id">{{ t('wallets.walletOption', { name: wallet.name, chain: wallet.chainFamily, kind: wallet.kind }) }}</option></select></label>
      <template v-if="selectedWallet">
        <dl class="wallet-descriptor"><div><dt>{{ t('wallets.address') }}</dt><dd><code>{{ selectedWallet.publicAddress }}</code></dd></div><div><dt>{{ t('wallets.network') }}</dt><dd>{{ t('wallets.networkValue', { name: selectedWallet.network.name, environment: selectedWallet.network.environment }) }}</dd></div><div><dt>{{ t('wallets.rpcEndpoint') }}</dt><dd><code>{{ selectedWallet.network.rpcUrl }}</code></dd></div><div><dt>{{ t('wallets.capabilities') }}</dt><dd>{{ selectedWallet.capabilities.join(', ') }}</dd></div><div><dt>{{ t('wallets.recovery') }}</dt><dd>{{ selectedWallet.recoveryConfirmed ? t('wallets.recoveryConfirmed') : t('wallets.recoveryRequired') }}</dd></div></dl>
        <section class="wallet-access-panel wallet-configured-access" aria-labelledby="wallet-configured-access-heading">
          <div class="wallet-access-heading"><h5 id="wallet-configured-access-heading">{{ t('wallets.workspaceAccessHeading') }}</h5><p>{{ t('wallets.workspaceAccessDescription') }}</p></div>
          <div class="wallet-scope-options" role="radiogroup" :aria-label="t('wallets.workspaceAccessHeading')">
            <label class="wallet-choice-card"><input v-model="configuredWorkspaceScope" type="radio" value="selected" :aria-label="t('wallets.selectedWorkspaces')" :disabled="controller.busy.value"><span><strong>{{ t('wallets.selectedWorkspaces') }}</strong><small>{{ t('wallets.selectedWorkspacesDescription') }}</small></span></label>
            <label class="wallet-choice-card"><input v-model="configuredWorkspaceScope" type="radio" value="all" :aria-label="t('wallets.anyWorkspace')" :disabled="controller.busy.value"><span><strong>{{ t('wallets.anyWorkspace') }}</strong><small>{{ t('wallets.anyWorkspaceDescription') }}</small></span></label>
          </div>
          <fieldset :disabled="controller.busy.value || configuredWorkspaceScope === 'all'"><legend>{{ t('wallets.chooseWorkspaces') }}</legend><label v-for="workspace in workspaces" :key="workspace.id"><input v-model="configuredWorkspaceIds" type="checkbox" :value="workspace.id"> {{ workspace.name }}</label><p v-if="workspaces.length === 0">{{ t('wallets.noWorkspaces') }}</p></fieldset>
          <p class="wallet-access-security-note">{{ t('wallets.workspaceAccessSecurity') }}</p>
        </section>
        <form v-if="renamingWallet" class="wallet-rename-form" @submit.prevent="saveWalletName"><label>{{ t('wallets.walletName') }} <input v-model="renameDraft" maxlength="128" required @keydown.esc="cancelWalletRename"></label><div class="wallet-actions"><button class="primary-button" type="submit" :disabled="controller.busy.value || !renameDraft.trim()">{{ t('wallets.saveName') }}</button><button class="secondary-button" type="button" @click="cancelWalletRename">{{ t('wallets.cancel') }}</button></div></form>
        <form v-if="editingRpc" class="wallet-rpc-form" @submit.prevent="saveWalletRpc"><label>{{ configuredRpcLabel }} <input v-model="rpcDraft" type="url" required :aria-invalid="configuredRpcValid ? undefined : 'true'" @keydown.esc="cancelWalletRpcEdit"></label><p>{{ t('wallets.rpcChangeWarning') }}</p><div class="wallet-actions"><button class="primary-button" type="submit" :disabled="controller.busy.value || !configuredRpcValid || rpcDraft.trim() === selectedWallet.network.rpcUrl">{{ t('wallets.saveRpc') }}</button><button class="secondary-button" type="button" @click="cancelWalletRpcEdit">{{ t('wallets.cancel') }}</button></div></form>
        <div class="wallet-actions"><button class="secondary-button" type="button" :disabled="controller.busy.value" @click="attachWorkspaces">{{ t('wallets.saveWorkspaceAccess') }}</button><button v-if="!renamingWallet" class="secondary-button" type="button" :disabled="controller.busy.value" @click="renameWallet">{{ t('wallets.rename') }}</button><button v-if="!editingRpc" class="secondary-button" type="button" :disabled="controller.busy.value" @click="editWalletRpc">{{ t('wallets.changeRpc') }}</button><button class="danger-button" type="button" :disabled="controller.busy.value" @click="removeWallet">{{ t('wallets.remove') }}</button></div>

        <div class="wallet-subsection"><h5>{{ t('wallets.boundedHeading') }}</h5><p>{{ t('wallets.boundedDescription') }}</p>
          <label v-if="mainnetBypassSupported" class="wallet-choice-card wallet-bypass-option"><input v-model="policyBypassApprove" type="checkbox" :aria-label="t('wallets.bypassApprove')"><span><strong>{{ t('wallets.bypassApprove') }}</strong><small>{{ t('wallets.bypassApproveDescription') }}</small></span></label>
          <p v-else-if="selectedWalletIsMainnet" class="wallet-mainnet-bypass-unavailable">{{ t('wallets.bypassApproveUnavailable') }}</p>
          <div class="wallet-form"><label class="wallet-wide">{{ t('wallets.policyWorkspace') }} <select v-model="policyWorkspaceId" required :disabled="policyWorkspaceOptions.length === 0"><option value="" disabled>{{ t('wallets.selectPolicyWorkspace') }}</option><option v-for="workspace in policyWorkspaceOptions" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option></select></label><p v-if="policyWorkspaceOptions.length === 0" class="wallet-wide wallet-form-note">{{ t('wallets.policyWorkspaceRequired') }}</p><label>{{ t('wallets.allowedOrigin') }} <input v-model="policyOrigin" type="url" required :placeholder="t('wallets.originPlaceholder')"></label><label>{{ t('wallets.destinationContract') }} <input v-model="policyDestination" required></label><label>{{ t('wallets.methodInstruction') }} <input v-model="policyMethod" required :placeholder="t('wallets.methodPlaceholder')"></label><label>{{ t('wallets.maxNativeAmount') }} <input v-model="policyMaxAmount" inputmode="decimal"></label><label>{{ t('wallets.maxTokenAmount') }} <input v-model="policyMaxTokenAmount" inputmode="decimal"></label><label>{{ t('wallets.maxFee') }} <input v-model="policyMaxFee" inputmode="decimal"></label><label>{{ t('wallets.sessionSpend') }} <input v-model="policySessionLimit" inputmode="decimal"></label><label>{{ t('wallets.dailySpend') }} <input v-model="policyDailyLimit" inputmode="decimal"></label><label>{{ t('wallets.operationCount') }} <input v-model.number="policyMaximumOperations" type="number" min="1" :max="selectedWalletIsMainnet ? 100 : 1000000"></label><label>{{ t('wallets.expires') }} <input v-model="policyExpiry" type="datetime-local"></label><button class="primary-button" type="button" :disabled="controller.busy.value || !canAddBoundedPolicy" @click="addPolicy">{{ selectedWalletIsMainnet ? t('wallets.enableBypassApprove') : t('wallets.addBoundedPolicy') }}</button></div>
          <ul class="wallet-list"><li v-for="policy in selectedPolicies" :key="policy.id"><span><strong>{{ policy.name }}</strong><small>{{ policy.allowMainnetAgentAutomation ? t('wallets.policyBypassValue', { origins: policy.origins.join(', ') }) : t('wallets.policyValue', { mode: policy.mode, origins: policy.origins.join(', ') }) }}</small></span><button type="button" :disabled="controller.busy.value" @click="controller.removePolicy(policy.id)">{{ t('wallets.remove') }}</button></li></ul>
        </div>

        <div class="wallet-subsection"><h5>{{ t('wallets.websitePermissions') }}</h5><ul class="wallet-list"><li v-for="permission in selectedPermissions" :key="permission.id"><span><strong>{{ permission.origin }}</strong><small>{{ t('wallets.permissionValue', { workspace: permission.workspaceId, expires: new Date(permission.expiresAt).toLocaleString() }) }}</small></span><button type="button" :disabled="controller.busy.value" @click="controller.revokePermission(permission.id)">{{ t('wallets.revoke') }}</button></li></ul></div>
      </template>
    </section>

    <section class="wallet-card"><h4>{{ t('wallets.requestsAudit') }}</h4><p>{{ t('wallets.requestsAuditCount', { requests: controller.requests.value.length, events: controller.audit.value.length }) }}</p><button class="secondary-button" type="button" @click="controller.refreshDetails">{{ t('wallets.refresh') }}</button><details><summary>{{ t('wallets.recentAudit') }}</summary><ul class="wallet-list"><li v-for="entry in controller.audit.value.slice(-20).reverse()" :key="entry.sequence"><span><strong>{{ entry.type }}</strong><small>{{ t('wallets.auditValue', { time: new Date(entry.timestamp).toLocaleString(), sequence: entry.sequence }) }}</small></span></li></ul></details></section>
    <output v-if="controller.errorMessage.value" class="site-controls-error" role="alert">{{ controller.errorMessage.value }}</output>
  </div>
</template>
