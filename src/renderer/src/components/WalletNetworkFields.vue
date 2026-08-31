<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  walletNetworkValidationIssue,
  type WalletChainFamily,
  type WalletNetwork
} from '../../../shared/wallet.js'
import {
  walletNetworkPreset,
  walletNetworkPresetsFor
} from '../../../shared/wallet-network-presets.js'

const props = defineProps<{
  chainFamily: WalletChainFamily
  disabled?: boolean
}>()
const network = defineModel<WalletNetwork>({ required: true })
const presetId = defineModel<string>('presetId', { required: true })
const { t } = useI18n({ useScope: 'global' })

const presets = computed(() => walletNetworkPresetsFor(props.chainFamily))
const selectedPreset = computed(() => walletNetworkPreset(presetId.value))
const custom = computed(() => presetId.value === 'custom')
const showPublicRpcNotice = computed(() => selectedPreset.value?.publicEndpoint === true)
const mainnet = computed(() => network.value.environment === 'mainnet')
const tronMainnet = computed(() => props.chainFamily === 'tron' && mainnet.value)
const normalizedId = computed(() => network.value.id.trim())
const idValidationIssue = computed(() => normalizedId.value
  ? walletNetworkValidationIssue(props.chainFamily, { id: normalizedId.value })
  : 'network-id-required')
const nameInvalid = computed(() => network.value.name.trim().length === 0)
const rpcInvalid = computed(() => {
  try {
    const url = new URL(network.value.rpcUrl.trim())
    return url.protocol !== 'http:' && url.protocol !== 'https:'
  } catch {
    return true
  }
})
const idLabel = computed(() => props.chainFamily === 'evm'
  ? t('wallets.evmChainId')
  : props.chainFamily === 'solana'
    ? t('wallets.solanaCluster')
    : t('wallets.tronNetwork'))
const rpcLabel = computed(() => props.chainFamily === 'evm'
  ? t('wallets.evmRpcUrl')
  : props.chainFamily === 'solana'
    ? t('wallets.solanaRpcUrl')
    : t('wallets.tronRpcUrl'))

function choosePreset(event: Event): void {
  const key = (event.target as HTMLSelectElement).value
  if (key === 'custom') return
  const preset = walletNetworkPreset(key)
  if (!preset || preset.chainFamily !== props.chainFamily) return
  network.value = { ...preset.network }
}

function updateNetwork(field: keyof WalletNetwork, value: string): void {
  network.value = { ...network.value, [field]: value }
}
</script>

<template>
  <section class="wallet-network-fields wallet-wide" :aria-label="t('wallets.networkSetup')">
    <div class="wallet-network-heading">
      <div>
        <strong>{{ t('wallets.networkSetup') }}</strong>
        <small>{{ t('wallets.networkSetupDescription') }}</small>
      </div>
      <span v-if="selectedPreset">{{ selectedPreset.network.environment }}</span>
    </div>

    <label class="wallet-wide">
      {{ t('wallets.networkPreset') }}
      <select v-model="presetId" :disabled="disabled" @change="choosePreset">
        <optgroup :label="t('wallets.environments.testnet')">
          <option v-for="entry in presets.filter((item) => item.network.environment === 'testnet')" :key="entry.key" :value="entry.key">{{ entry.network.name }}</option>
        </optgroup>
        <optgroup :label="t('wallets.environments.mainnet')">
          <option v-for="entry in presets.filter((item) => item.network.environment === 'mainnet')" :key="entry.key" :value="entry.key">{{ entry.network.name }}</option>
        </optgroup>
        <optgroup :label="t('wallets.environments.local')">
          <option v-for="entry in presets.filter((item) => item.network.environment === 'local')" :key="entry.key" :value="entry.key">{{ entry.network.name }}</option>
        </optgroup>
        <option value="custom">{{ t('wallets.customNetwork') }}</option>
      </select>
    </label>

    <div class="wallet-network-grid">
      <label>
        {{ idLabel }}
        <input
          :value="network.id"
          :inputmode="chainFamily === 'evm' ? 'numeric' : 'text'"
          :aria-invalid="idValidationIssue ? 'true' : undefined"
          :aria-describedby="idValidationIssue ? 'wallet-network-id-error' : undefined"
          maxlength="128"
          required
          :disabled="disabled || !custom"
          @input="updateNetwork('id', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label>
        {{ t('wallets.networkName') }}
        <input
          :value="network.name"
          :aria-invalid="nameInvalid ? 'true' : undefined"
          :aria-describedby="nameInvalid ? 'wallet-network-name-error' : undefined"
          maxlength="128"
          required
          :disabled="disabled || !custom"
          @input="updateNetwork('name', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label>
        {{ t('wallets.environment') }}
        <select
          :value="network.environment"
          :disabled="disabled || !custom"
          @change="updateNetwork('environment', ($event.target as HTMLSelectElement).value)"
        >
          <option value="local">{{ t('wallets.environments.local') }}</option>
          <option value="testnet">{{ t('wallets.environments.testnet') }}</option>
          <option value="mainnet">{{ t('wallets.environments.mainnet') }}</option>
        </select>
      </label>
      <label class="wallet-network-rpc">
        {{ rpcLabel }}
        <input
          :value="network.rpcUrl"
          type="url"
          :aria-invalid="rpcInvalid ? 'true' : undefined"
          :aria-describedby="rpcInvalid ? 'wallet-network-rpc-error' : undefined"
          required
          :disabled="disabled"
          @input="updateNetwork('rpcUrl', ($event.target as HTMLInputElement).value)"
        >
      </label>
    </div>

    <p v-if="idValidationIssue" id="wallet-network-id-error" class="wallet-network-error" role="alert">{{ t(idValidationIssue === 'evm-chain-id-invalid' ? 'wallets.evmChainIdInvalid' : 'wallets.networkIdRequired') }}</p>
    <p v-if="nameInvalid" id="wallet-network-name-error" class="wallet-network-error" role="alert">{{ t('wallets.networkNameRequired') }}</p>
    <p v-if="rpcInvalid" id="wallet-network-rpc-error" class="wallet-network-error" role="alert">{{ t('wallets.rpcUrlInvalid') }}</p>

    <p v-if="showPublicRpcNotice" class="wallet-network-notice">{{ t('wallets.publicRpcNotice') }}</p>
    <p v-if="mainnet" class="wallet-network-warning" role="alert">{{ t('wallets.mainnetWarning') }}</p>
    <p v-if="tronMainnet" class="wallet-network-warning" role="alert">{{ t('wallets.tronMainnetWarning') }}</p>
  </section>
</template>
