<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WalletsController } from '../composables/useWalletsController.js'
import type { WalletChainFamily, WalletPolicy, WalletSecretFormat } from '../../../shared/wallet.js'

const props = defineProps<{
  controller: WalletsController
  workspaces: Array<{ id: string; name: string }>
}>()
const { t } = useI18n({ useScope: 'global' })

const mode = ref<'generate' | 'import' | 'watch'>('generate')
const walletModes = ['generate', 'import', 'watch'] as const
const selectedWalletId = ref('')
const name = ref('')
const chainFamily = ref<WalletChainFamily>('evm')
const networkId = ref('11155111')
const networkName = ref('Sepolia')
const networkEnvironment = ref<'local' | 'testnet' | 'mainnet'>('testnet')
const rpcUrl = ref('http://127.0.0.1:8545')
const selectedWorkspaceIds = ref<string[]>([])
const watchAddress = ref('')
const secretFormat = ref<WalletSecretFormat>('mnemonic')
const recoveryInput = ref<HTMLTextAreaElement | null>(null)
const passphraseInput = ref<HTMLInputElement | null>(null)
const preparedImport = ref<{ token: string; publicAddress: string } | null>(null)
const policyOrigin = ref('')
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

const selectedWallet = computed(() => props.controller.wallets.value.find((wallet) => wallet.id === selectedWalletId.value))
const selectedPolicies = computed(() => props.controller.policies.value.filter((policy) => policy.walletId === selectedWalletId.value))
const selectedPermissions = computed(() => props.controller.permissions.value.filter((permission) => permission.walletId === selectedWalletId.value))
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
  selectedWorkspaceIds.value = wallet ? [...wallet.workspaceIds] : props.workspaces[0] ? [props.workspaces[0].id] : []
})

function network() {
  return {
    id: networkId.value.trim(), name: networkName.value.trim(), environment: networkEnvironment.value, rpcUrl: rpcUrl.value.trim()
  }
}

async function submitOnboarding(): Promise<void> {
  const input = {
    name: name.value.trim(), chainFamily: chainFamily.value, network: network(), workspaceIds: [...selectedWorkspaceIds.value]
  }
  if (mode.value === 'generate') {
    await props.controller.generate({ ...input, dedicatedAgent: dedicatedAgent.value })
  } else if (mode.value === 'watch') {
    await props.controller.addWatchOnly({ ...input, publicAddress: watchAddress.value.trim() })
  } else {
    const secret = recoveryInput.value?.value ?? ''
    if (recoveryInput.value) recoveryInput.value.value = ''
    const prepared = await props.controller.prepareImport(chainFamily.value, secretFormat.value, secret)
    if (prepared) preparedImport.value = { token: prepared.token, publicAddress: prepared.publicAddress }
  }
}

async function confirmPreparedImport(): Promise<void> {
  if (!preparedImport.value) return
  const confirmed = await props.controller.confirmImport(preparedImport.value.token, {
    name: name.value.trim(), network: network(), workspaceIds: [...selectedWorkspaceIds.value], dedicatedAgent: dedicatedAgent.value
  })
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

async function attachWorkspaces(): Promise<void> {
  if (selectedWallet.value) await props.controller.update(selectedWallet.value.id, { workspaceIds: [...selectedWorkspaceIds.value] })
}

async function renameWallet(): Promise<void> {
  const wallet = selectedWallet.value
  if (!wallet) return
  const next = window.prompt(t('wallets.newName'), wallet.name)?.trim()
  if (next) await props.controller.update(wallet.id, { name: next })
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
    workspaceId: selectedWorkspaceIds.value[0] ?? wallet.workspaceIds[0] ?? '', networkIds: [wallet.network.id],
    origins: [policyOrigin.value.trim()], destinations: [policyDestination.value.trim()], methods: [policyMethod.value.trim()],
    ...(policyMaxAmount.value ? { maxNativeAmount: policyMaxAmount.value } : {}),
    ...(policyMaxTokenAmount.value ? { maxTokenAmount: policyMaxTokenAmount.value } : {}),
    ...(policyMaxFee.value ? { maxFee: policyMaxFee.value } : {}),
    ...(policySessionLimit.value ? { sessionSpendLimit: policySessionLimit.value } : {}),
    ...(policyDailyLimit.value ? { dailySpendLimit: policyDailyLimit.value } : {}),
    expiresAt: expiry, maximumOperationCount: policyMaximumOperations.value,
    requireSuccessfulSimulation: true, allowMessageSigning: false
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
      <input ref="passphraseInput" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required>
      <button class="primary-button" type="submit" :disabled="controller.busy.value">{{ t('wallets.createEncryptedVault') }}</button>
    </form>
    <form v-else-if="controller.status.value.managedWallets === 'locked'" class="wallet-card" @submit.prevent="submitPassphrase('unlock')">
      <h4>{{ t('wallets.unlockVault') }}</h4>
      <input ref="passphraseInput" type="password" minlength="12" maxlength="1024" autocomplete="current-password" required>
      <button class="primary-button" type="submit" :disabled="controller.busy.value">{{ t('wallets.unlock') }}</button>
    </form>

    <section class="wallet-card">
      <div class="wallet-card-heading"><h4>{{ t('wallets.addWallet') }}</h4><span>{{ t('wallets.secretsNotCopied') }}</span></div>
      <div class="wallet-mode-tabs">
        <button v-for="entry in walletModes" :key="entry" type="button" :class="{ active: mode === entry }" @click="mode = entry">{{ t(`wallets.modes.${entry}`) }}</button>
      </div>
      <form class="wallet-form" @submit.prevent="submitOnboarding">
        <label>{{ t('wallets.name') }} <input v-model="name" maxlength="128" required></label>
        <label>{{ t('wallets.chain') }} <select v-model="chainFamily"><option value="evm">{{ t('wallets.chains.evm') }}</option><option value="solana">{{ t('wallets.chains.solana') }}</option><option value="tron">{{ t('wallets.chains.tron') }}</option></select></label>
        <label>{{ t('wallets.environment') }} <select v-model="networkEnvironment"><option value="local">{{ t('wallets.environments.local') }}</option><option value="testnet">{{ t('wallets.environments.testnet') }}</option><option value="mainnet">{{ t('wallets.environments.mainnet') }}</option></select></label>
        <label>{{ t('wallets.networkId') }} <input v-model="networkId" maxlength="128" required></label>
        <label>{{ t('wallets.networkName') }} <input v-model="networkName" maxlength="128" required></label>
        <label class="wallet-wide">{{ t('wallets.rpcUrl') }} <input v-model="rpcUrl" type="url" required></label>
        <label v-if="mode === 'watch'" class="wallet-wide">{{ t('wallets.publicAddress') }} <input v-model="watchAddress" maxlength="256" required></label>
        <template v-if="mode === 'import'">
          <label>{{ t('wallets.secretFormat') }} <select v-model="secretFormat"><option value="mnemonic">{{ t('wallets.mnemonic') }}</option><option value="private-key">{{ t('wallets.privateKey') }}</option></select></label>
          <label class="wallet-wide">{{ t('wallets.recoveryMaterial') }} <textarea ref="recoveryInput" rows="3" required autocomplete="off" spellcheck="false"></textarea></label>
        </template>
        <label v-if="mode !== 'watch'" class="wallet-wide wallet-agent-option"><input v-model="dedicatedAgent" type="checkbox"> {{ t('wallets.dedicatedAgent') }}</label>
        <p v-if="mode !== 'watch' && dedicatedAgent" class="wallet-wide wallet-form-note">{{ t('wallets.dedicatedAgentDescription') }}</p>
        <fieldset class="wallet-wide"><legend>{{ t('wallets.attachedWorkspaces') }}</legend><label v-for="workspace in workspaces" :key="workspace.id"><input v-model="selectedWorkspaceIds" type="checkbox" :value="workspace.id"> {{ workspace.name }}</label></fieldset>
        <button class="primary-button" type="submit" :disabled="controller.busy.value || (mode === 'watch' ? !controller.status.value.watchOnlyAvailable : controller.status.value.managedWallets !== 'ready')">{{ mode === 'import' ? t('wallets.validateImport') : t('wallets.addWallet') }}</button>
      </form>
      <div v-if="preparedImport" class="wallet-import-confirm">
        <strong>{{ t('wallets.confirmDerivedAddress') }}</strong><code>{{ preparedImport.publicAddress }}</code>
        <button class="primary-button" type="button" @click="confirmPreparedImport">{{ t('wallets.confirmAndEncrypt') }}</button>
        <button class="secondary-button" type="button" @click="cancelPreparedImport">{{ t('wallets.cancel') }}</button>
      </div>
    </section>

    <section class="wallet-card">
      <div class="wallet-card-heading"><h4>{{ t('wallets.configured') }}</h4><button v-if="controller.status.value.managedWallets === 'ready'" class="secondary-button" type="button" @click="controller.lock">{{ t('wallets.lockVault') }}</button></div>
      <select v-model="selectedWalletId" class="wallet-selector"><option value="" disabled>{{ t('wallets.selectWallet') }}</option><option v-for="wallet in controller.wallets.value" :key="wallet.id" :value="wallet.id">{{ t('wallets.walletOption', { name: wallet.name, chain: wallet.chainFamily, kind: wallet.kind }) }}</option></select>
      <template v-if="selectedWallet">
        <dl class="wallet-descriptor"><div><dt>{{ t('wallets.address') }}</dt><dd><code>{{ selectedWallet.publicAddress }}</code></dd></div><div><dt>{{ t('wallets.network') }}</dt><dd>{{ t('wallets.networkValue', { name: selectedWallet.network.name, environment: selectedWallet.network.environment }) }}</dd></div><div><dt>{{ t('wallets.capabilities') }}</dt><dd>{{ selectedWallet.capabilities.join(', ') }}</dd></div><div><dt>{{ t('wallets.recovery') }}</dt><dd>{{ selectedWallet.recoveryConfirmed ? t('wallets.recoveryConfirmed') : t('wallets.recoveryRequired') }}</dd></div></dl>
        <fieldset><legend>{{ t('wallets.workspaceAccess') }}</legend><label v-for="workspace in workspaces" :key="workspace.id"><input v-model="selectedWorkspaceIds" type="checkbox" :value="workspace.id"> {{ workspace.name }}</label></fieldset>
        <div class="wallet-actions"><button class="secondary-button" type="button" @click="attachWorkspaces">{{ t('wallets.saveWorkspaceAccess') }}</button><button class="secondary-button" type="button" @click="renameWallet">{{ t('wallets.rename') }}</button><button class="danger-button" type="button" @click="removeWallet">{{ t('wallets.remove') }}</button></div>

        <div class="wallet-subsection"><h5>{{ t('wallets.boundedHeading') }}</h5><p>{{ t('wallets.boundedDescription') }}</p>
          <div class="wallet-form"><label>{{ t('wallets.allowedOrigin') }} <input v-model="policyOrigin" type="url" :placeholder="t('wallets.originPlaceholder')"></label><label>{{ t('wallets.destinationContract') }} <input v-model="policyDestination"></label><label>{{ t('wallets.methodInstruction') }} <input v-model="policyMethod" :placeholder="t('wallets.methodPlaceholder')"></label><label>{{ t('wallets.maxNativeAmount') }} <input v-model="policyMaxAmount" inputmode="decimal"></label><label>{{ t('wallets.maxTokenAmount') }} <input v-model="policyMaxTokenAmount" inputmode="decimal"></label><label>{{ t('wallets.maxFee') }} <input v-model="policyMaxFee" inputmode="decimal"></label><label>{{ t('wallets.sessionSpend') }} <input v-model="policySessionLimit" inputmode="decimal"></label><label>{{ t('wallets.dailySpend') }} <input v-model="policyDailyLimit" inputmode="decimal"></label><label>{{ t('wallets.operationCount') }} <input v-model.number="policyMaximumOperations" type="number" min="1" max="1000000"></label><label>{{ t('wallets.expires') }} <input v-model="policyExpiry" type="datetime-local"></label><button class="primary-button" type="button" @click="addPolicy">{{ t('wallets.addBoundedPolicy') }}</button></div>
          <ul class="wallet-list"><li v-for="policy in selectedPolicies" :key="policy.id"><span><strong>{{ policy.name }}</strong><small>{{ t('wallets.policyValue', { mode: policy.mode, origins: policy.origins.join(', ') }) }}</small></span><button type="button" @click="controller.removePolicy(policy.id)">{{ t('wallets.remove') }}</button></li></ul>
        </div>

        <div class="wallet-subsection"><h5>{{ t('wallets.websitePermissions') }}</h5><ul class="wallet-list"><li v-for="permission in selectedPermissions" :key="permission.id"><span><strong>{{ permission.origin }}</strong><small>{{ t('wallets.permissionValue', { workspace: permission.workspaceId, expires: new Date(permission.expiresAt).toLocaleString() }) }}</small></span><button type="button" @click="controller.revokePermission(permission.id)">{{ t('wallets.revoke') }}</button></li></ul></div>
      </template>
    </section>

    <section class="wallet-card"><h4>{{ t('wallets.requestsAudit') }}</h4><p>{{ t('wallets.requestsAuditCount', { requests: controller.requests.value.length, events: controller.audit.value.length }) }}</p><button class="secondary-button" type="button" @click="controller.refreshDetails">{{ t('wallets.refresh') }}</button><details><summary>{{ t('wallets.recentAudit') }}</summary><ul class="wallet-list"><li v-for="entry in controller.audit.value.slice(-20).reverse()" :key="entry.sequence"><span><strong>{{ entry.type }}</strong><small>{{ t('wallets.auditValue', { time: new Date(entry.timestamp).toLocaleString(), sequence: entry.sequence }) }}</small></span></li></ul></details></section>
    <output v-if="controller.errorMessage.value" class="site-controls-error" role="alert">{{ controller.errorMessage.value }}</output>
  </div>
</template>
