<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import UiOverlayTransition from "../ui/UiOverlayTransition.vue"
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WalletsController } from '../composables/useWalletsController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'
import {
  WALLET_MESSAGE_DISPLAY_MAX_LENGTH,
  type WalletMessageWarning,
  type WalletTransactionWarning,
  type WalletTypedDataWarning
} from '../../../shared/wallet.js'

const props = defineProps<{
  controller: WalletsController
  workspaces: readonly { id: string; name: string }[]
}>()
const { t, locale } = useI18n({ useScope: 'global' })
const request = computed(() => props.controller.awaitingApproval.value[0])
const open = computed(() => Boolean(request.value))
const requestId = computed(() => request.value?.id)
const workspaceName = computed(() => {
  const workspaceId = request.value?.workspaceId
  if (!workspaceId) return ''
  return props.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId
})
const panel = ref<HTMLElement | null>(null)

useModalDialogFocus({ open, panel, focusKey: requestId })

/** A request's dialog takes clicks once it has appeared, never while a click aimed at the page could land on it unseen. */
const ENTRANCE_LIMIT_MS = 1_500
const enteringRequestId = ref<string>()
let entranceTimer: ReturnType<typeof setTimeout> | undefined

function settleEntrance(): void {
  if (entranceTimer !== undefined) clearTimeout(entranceTimer)
  entranceTimer = undefined
  enteringRequestId.value = undefined
}

watch(requestId, async (id) => {
  settleEntrance()
  if (!id) return
  enteringRequestId.value = id
  // The entrance can wait for the page snapshot first; a stalled one still ends.
  entranceTimer = setTimeout(settleEntrance, ENTRANCE_LIMIT_MS)
  await nextTick()
  if (requestId.value !== id || enteringRequestId.value !== id) return
  const animation = panel.value ? getComputedStyle(panel.value).animationName : ''
  if (!animation || animation === 'none') settleEntrance()
}, { immediate: true })

onBeforeUnmount(settleEntrance)

const messageWarningKeys: Record<WalletMessageWarning, string> = {
  'hidden-characters': 'hiddenCharacters',
  'sign-in-other-site': 'signInOtherSite',
  'sign-in-other-account': 'signInOtherAccount',
  'sign-in-other-chain': 'signInOtherChain',
  'sign-in-unverified': 'signInUnverified'
}

const typedDataWarningKeys: Record<WalletTypedDataWarning, string> = {
  'typed-data-other-chain': 'otherChain',
  'token-permit': 'tokenPermit',
  'token-transfer': 'tokenTransfer',
  'unlimited-amount': 'unlimitedAmount',
  'unreadable-amount': 'unreadableAmount',
  'no-expiry': 'noExpiry',
  'asset-order': 'assetOrder',
  'safe-transaction': 'safeTransaction',
  'forwarded-call': 'forwardedCall'
}

const transactionWarningKeys: Record<WalletTransactionWarning, string> = {
  'token-approval': 'tokenApproval',
  'allowance-increase': 'allowanceIncrease',
  'unlimited-allowance': 'unlimitedAllowance',
  'collection-approval': 'collectionApproval'
}

// An approval's destination is who it lets move the tokens, not where they go.
const destinationLabelKeys: Readonly<Record<string, string>> = {
  'erc20.approve': 'spender',
  'erc20.increaseAllowance': 'spender',
  'trc20.approve': 'spender',
  'nft.setApprovalForAll': 'operator'
}
const destinationLabel = computed(() => t(`wallets.approval.${destinationLabelKeys[request.value?.details?.method ?? ''] ?? 'destination'}`))
// The contract's own words, shown apart from Hronaut's text so they cannot pass for it.
const revertMessage = computed(() => {
  const revert = request.value?.details?.simulationRevert
  return revert?.kind === 'message' ? revert : undefined
})
const revertReason = computed(() => {
  const revert = request.value?.details?.simulationRevert
  if (!revert || revert.kind === 'message') return undefined
  if (revert.kind === 'panic') return revert.meaning
    ? t('wallets.approval.revertPanicMeaning', { code: revert.code, meaning: revert.meaning })
    : t('wallets.approval.revertPanic', { code: revert.code })
  if (revert.kind === 'custom-error') return revert.name
    ? t('wallets.approval.revertNamedCustomError', { name: revert.name, selector: revert.selector })
    : t('wallets.approval.revertCustomError', { selector: revert.selector })
  return t('wallets.approval.revertNoReason')
})

// Transfers move an amount once; permits grant an allowance. Several are numbered.
function tokenAmountLabel(index: number): string {
  const tokenAccess = request.value?.details?.typedData?.tokenAccess
  const key = tokenAccess?.kind === 'transfer' ? 'transferAmount' : 'allowance'
  return (tokenAccess?.allowances.length ?? 0) > 1
    ? t(`wallets.approval.typedData.${key}Numbered`, { number: index + 1 })
    : t(`wallets.approval.typedData.${key}`)
}

function appText(domain: { name?: string; version?: string }): string {
  if (domain.name && domain.version) return t('wallets.approval.typedData.appVersion', { name: domain.name, version: domain.version })
  return domain.name || t('wallets.approval.typedData.versionOnly', { version: domain.version })
}

function rawDetails(): string {
  return JSON.stringify(request.value?.details?.raw ?? {}, null, 2)
}
</script>

<template>
  <UiOverlayTransition>
    <div v-if="request" class="wallet-approval-overlay">
      <section
        :key="request.id"
        ref="panel"
        class="wallet-approval-dialog"
        :class="{ 'wallet-approval-dialog--entering': enteringRequestId === request.id }"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wallet-approval-title"
        tabindex="-1"
        @animationend.self="settleEntrance"
        @animationcancel.self="settleEntrance"
      >
        <header>
          <span class="eyebrow">{{ t('wallets.approval.eyebrow') }}</span>
          <h2 id="wallet-approval-title">{{ t('wallets.approval.operation', { operation: request.operation.replaceAll('-', ' ') }) }}</h2>
          <p>{{ t('wallets.approval.description') }}</p>
        </header>
        <dl class="wallet-approval-grid">
          <div><dt>{{ t('wallets.approval.wallet') }}</dt><dd>{{ request.details?.walletName ?? request.walletId }}</dd></div>
          <div><dt>{{ t('wallets.approval.account') }}</dt><dd><code>{{ request.details?.publicAddress }}</code></dd></div>
          <div><dt>{{ t('wallets.approval.network') }}</dt><dd>{{ request.details?.networkName ?? request.networkId }}</dd></div>
          <div><dt>{{ t('wallets.approval.origin') }}</dt><dd><code>{{ request.origin }}</code></dd></div>
          <div><dt>{{ t('wallets.approval.workspace') }}</dt><dd :title="request.workspaceId">{{ workspaceName }}</dd></div>
          <div><dt>{{ t('wallets.approval.requester') }}</dt><dd>{{ t('wallets.approval.requesterValue', { name: request.requester.name ?? request.requester.id, type: request.requester.type }) }}</dd></div>
          <div v-if="request.details?.method"><dt>{{ t('wallets.approval.method') }}</dt><dd>{{ request.details.method }}</dd></div>
          <div v-if="request.details?.contract"><dt>{{ t('wallets.approval.contract') }}</dt><dd><code>{{ request.details.contract }}</code></dd></div>
          <div v-if="request.details?.source"><dt>{{ t('wallets.approval.source') }}</dt><dd><code>{{ request.details.source }}</code></dd></div>
          <div v-if="request.details?.destination"><dt>{{ destinationLabel }}</dt><dd><code>{{ request.details.destination }}</code></dd></div>
          <div v-if="request.details?.nativeAmount"><dt>{{ t('wallets.approval.nativeAmount') }}</dt><dd>{{ request.details.nativeAmount }}</dd></div>
          <div v-if="request.details?.tokenAmount"><dt>{{ t('wallets.approval.tokenAmount') }}</dt><dd>{{ request.details.tokenAmount }}</dd></div>
          <div v-if="request.details?.estimatedFee"><dt>{{ t('wallets.approval.estimatedFee') }}</dt><dd>{{ request.details.estimatedFee }}</dd></div>
          <div><dt>{{ t('wallets.approval.simulation') }}</dt><dd>{{ request.details?.simulationSuccess ? t('wallets.approval.successful') : request.details?.simulationAttempted ? t('wallets.approval.failed') : t('wallets.approval.unavailable') }}</dd></div>
          <div v-if="revertMessage || revertReason">
            <dt>{{ t('wallets.approval.revertReason') }}</dt>
            <dd data-testid="wallet-approval-revert-reason">
              <template v-if="revertMessage"><code>{{ revertMessage.message }}</code><template v-if="revertMessage.truncated">{{ ` ${t('wallets.approval.revertMessageTruncated')}` }}</template></template>
              <template v-else>{{ revertReason }}</template>
            </dd>
          </div>
          <div><dt>{{ t('wallets.approval.expires') }}</dt><dd>{{ new Date(request.expiresAt).toLocaleString() }}</dd></div>
        </dl>
        <div v-if="!request.details?.understood" class="wallet-approval-warning" role="alert">
          {{ t('wallets.approval.undecodable') }}
        </div>
        <p v-for="warning in request.details?.transactionWarnings ?? []" :key="warning" class="wallet-approval-warning" role="alert">{{ t(`wallets.approval.transactionWarnings.${transactionWarningKeys[warning]}`) }}</p>
        <section v-if="request.details?.message" class="wallet-approval-message">
          <h3 id="wallet-approval-message-title">{{ t('wallets.approval.message') }}</h3>
          <p v-for="warning in request.details.message.warnings" :key="warning" class="wallet-approval-warning" role="alert">{{ t(`wallets.approval.messageWarnings.${messageWarningKeys[warning]}`) }}</p>
          <pre class="wallet-approval-message-text" role="region" tabindex="0" aria-labelledby="wallet-approval-message-title">{{ request.details.message.text }}</pre>
          <p v-if="request.details.message.truncated" class="wallet-approval-message-note">{{ t('wallets.approval.messageTruncated', { count: WALLET_MESSAGE_DISPLAY_MAX_LENGTH.toLocaleString(locale) }) }}</p>
        </section>
        <section v-if="request.details?.typedData" class="wallet-approval-message" aria-labelledby="wallet-approval-typed-data-title">
          <h3 id="wallet-approval-typed-data-title">{{ t('wallets.approval.typedData.heading') }}</h3>
          <p v-for="warning in request.details.typedData.warnings" :key="warning" class="wallet-approval-warning" role="alert">{{ t(`wallets.approval.typedData.warnings.${typedDataWarningKeys[warning]}`) }}</p>
          <dl class="wallet-approval-grid">
            <div><dt>{{ t('wallets.approval.typedData.type') }}</dt><dd>{{ request.details.typedData.primaryType || t('wallets.approval.typedData.none') }}</dd></div>
            <div v-if="request.details.typedData.domain.name || request.details.typedData.domain.version"><dt>{{ t('wallets.approval.typedData.app') }}</dt><dd>{{ appText(request.details.typedData.domain) }}</dd></div>
            <div v-if="request.details.typedData.domain.chainId"><dt>{{ t('wallets.approval.typedData.chainId') }}</dt><dd>{{ request.details.typedData.domain.chainId }}</dd></div>
            <div v-if="request.details.typedData.domain.verifyingContract"><dt>{{ t('wallets.approval.typedData.contract') }}</dt><dd><code>{{ request.details.typedData.domain.verifyingContract }}</code></dd></div>
            <div v-if="request.details.typedData.tokenAccess?.spender"><dt>{{ t('wallets.approval.typedData.spender') }}</dt><dd><code>{{ request.details.typedData.tokenAccess.spender }}</code></dd></div>
            <div v-if="request.details.typedData.tokenAccess?.recipient"><dt>{{ t('wallets.approval.typedData.recipient') }}</dt><dd><code>{{ request.details.typedData.tokenAccess.recipient }}</code></dd></div>
            <div v-for="(allowance, index) in request.details.typedData.tokenAccess?.allowances ?? []" :key="index">
              <dt>{{ tokenAmountLabel(index) }}</dt>
              <dd><code v-if="allowance.token">{{ allowance.token }}</code>{{ allowance.token ? ' · ' : '' }}{{ allowance.unlimited ? t('wallets.approval.typedData.unlimited') : allowance.amount ? t('wallets.approval.typedData.baseUnits', { amount: allowance.amount }) : t('wallets.approval.typedData.unknownAmount') }}</dd>
            </div>
            <div v-if="request.details.typedData.tokenAccess?.expiresAt || request.details.typedData.tokenAccess?.neverExpires"><dt>{{ t('wallets.approval.typedData.validUntil') }}</dt><dd>{{ request.details.typedData.tokenAccess.expiresAt ? new Date(request.details.typedData.tokenAccess.expiresAt).toLocaleString() : t('wallets.approval.typedData.neverExpires') }}</dd></div>
          </dl>
          <p v-if="request.details.typedData.tokenAccess?.moreAllowances" class="wallet-approval-message-note">{{ t('wallets.approval.typedData.moreAllowances') }}</p>
        </section>
        <details class="wallet-approval-raw">
          <summary>{{ t('wallets.approval.raw') }}</summary>
          <pre>{{ rawDetails() }}</pre>
        </details>
        <p class="wallet-approval-hash">{{ t('wallets.approval.hash') }} <code data-testid="wallet-approval-hash">{{ request.approvalHash ?? t('wallets.approval.hashPending') }}</code></p>
        <output v-if="controller.errorMessage.value" class="site-controls-error" role="alert">{{ controller.errorMessage.value }}</output>
        <footer>
          <UiButton type="button" :disabled="controller.busy.value" @click="controller.reject(request.id)">{{ t('wallets.approval.reject') }}</UiButton>
          <UiButton variant="primary" type="button" :disabled="controller.busy.value" @click="controller.approve(request.id)">{{ t('wallets.approval.approve') }}</UiButton>
        </footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
