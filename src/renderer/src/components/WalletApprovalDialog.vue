<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WalletsController } from '../composables/useWalletsController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

const props = defineProps<{
  controller: WalletsController
  workspaces: readonly { id: string; name: string }[]
}>()
const { t } = useI18n({ useScope: 'global' })
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

function rawDetails(): string {
  return JSON.stringify(request.value?.details?.raw ?? {}, null, 2)
}
</script>

<template>
  <div v-if="request" class="wallet-approval-overlay">
    <section :key="request.id" ref="panel" class="wallet-approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="wallet-approval-title" tabindex="-1">
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
        <div v-if="request.details?.destination"><dt>{{ t('wallets.approval.destination') }}</dt><dd><code>{{ request.details.destination }}</code></dd></div>
        <div v-if="request.details?.nativeAmount"><dt>{{ t('wallets.approval.nativeAmount') }}</dt><dd>{{ request.details.nativeAmount }}</dd></div>
        <div v-if="request.details?.tokenAmount"><dt>{{ t('wallets.approval.tokenAmount') }}</dt><dd>{{ request.details.tokenAmount }}</dd></div>
        <div v-if="request.details?.estimatedFee"><dt>{{ t('wallets.approval.estimatedFee') }}</dt><dd>{{ request.details.estimatedFee }}</dd></div>
        <div><dt>{{ t('wallets.approval.simulation') }}</dt><dd>{{ request.details?.simulationSuccess ? t('wallets.approval.successful') : request.details?.simulationAttempted ? t('wallets.approval.failed') : t('wallets.approval.unavailable') }}</dd></div>
        <div><dt>{{ t('wallets.approval.expires') }}</dt><dd>{{ new Date(request.expiresAt).toLocaleString() }}</dd></div>
      </dl>
      <div v-if="!request.details?.understood" class="wallet-approval-warning" role="alert">
        {{ t('wallets.approval.undecodable') }}
      </div>
      <details class="wallet-approval-raw">
        <summary>{{ t('wallets.approval.raw') }}</summary>
        <pre>{{ rawDetails() }}</pre>
      </details>
      <p class="wallet-approval-hash">{{ t('wallets.approval.hash') }} <code>{{ request.approvalHash ?? t('wallets.approval.hashPending') }}</code></p>
      <output v-if="controller.errorMessage.value" class="site-controls-error" role="alert">{{ controller.errorMessage.value }}</output>
      <footer>
        <UiButton appearance="application" class="secondary-button" type="button" :disabled="controller.busy.value" @click="controller.reject(request.id)">{{ t('wallets.approval.reject') }}</UiButton>
        <UiButton appearance="application" variant="primary" class="primary-button" type="button" :disabled="controller.busy.value" @click="controller.approve(request.id)">{{ t('wallets.approval.approve') }}</UiButton>
      </footer>
    </section>
  </div>
</template>
