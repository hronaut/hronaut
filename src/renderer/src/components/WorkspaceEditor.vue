<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, onBeforeUnmount, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDatabase from '~icons/material-symbols/database-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconShield from '~icons/material-symbols/shield-lock-rounded'
import IconSwapHoriz from '~icons/material-symbols/swap-horiz-rounded'
import type {
  BrowserState,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationAuditSource
} from '../../../shared/types.js'
import {
  BROWSER_TAB_GROUP_COLORS,
  BROWSER_TAB_GROUP_COLOR_HEX,
  tabGroupColorLabel
} from '../../../shared/tab-groups.js'
import { useWorkspaceEditorController } from '../composables/useWorkspaceEditorController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

const props = defineProps<{
  state: BrowserState
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  formatNumber: (value: number) => string
  canPresent: boolean
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const {
  mode,
  name,
  color,
  error,
  storageMode,
  transferDirection,
  originOptions,
  selectedOrigins,
  storageState,
  storageMessage,
  actionState,
  actionPending,
  navigationMode,
  navigationRulesText,
  navigationAudit,
  navigationAuditState,
  dismissBlocked,
  saveDisabled,
  isDefault,
  openExisting,
  openNew,
  close,
  save,
  transferStorage,
  closeWorkspace,
  toggleAllOrigins,
  dispose
} = useWorkspaceEditorController({
  state: toRef(props, 'state'),
  open,
  browser: window.hronaut,
  syncState: props.syncState,
  translate: (message, parameters) => t(message, parameters ?? {}),
  formatNumber: props.formatNumber,
  confirm: (message) => window.confirm(message),
  canPresent: () => props.canPresent
})

const pendingMessage = computed(() => {
  if (actionState.value === 'closing') return t('workspaceEditor.closing')
  if (actionState.value === 'saving') {
    return mode.value === 'create' ? t('workspaceEditor.creating') : t('workspaceEditor.saving')
  }
  return storageState.value === 'saving' ? t('workspaceEditor.copying') : ''
})

useModalDialogFocus({ open, panel, focusOnOpen: false })

function colorStyle(value: (typeof BROWSER_TAB_GROUP_COLORS)[number]): Record<string, string> {
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[value] }
}

function formatAuditTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function auditReasonLabel(reason: BrowserWorkspaceNavigationAuditEntry['reason']): string {
  if (reason === 'credentials') return t('workspaceNavigationAudit.reasonCredentials')
  if (reason === 'malformed') return t('workspaceNavigationAudit.reasonMalformed')
  if (reason === 'unsupported-scheme') return t('workspaceNavigationAudit.reasonUnsupportedScheme')
  return t('workspaceNavigationAudit.reasonNoMatch')
}

function auditSourceLabel(source: BrowserWorkspaceNavigationAuditSource): string {
  if (source === 'direct') return t('workspaceNavigationAudit.sourceDirect')
  if (source === 'page') return t('workspaceNavigationAudit.sourcePage')
  if (source === 'redirect') return t('workspaceNavigationAudit.sourceRedirect')
  if (source === 'popup') return t('workspaceNavigationAudit.sourcePopup')
  if (source === 'history') return t('workspaceNavigationAudit.sourceHistory')
  if (source === 'policy-change') return t('workspaceNavigationAudit.sourcePolicyChange')
  return t('workspaceNavigationAudit.sourceRestore')
}

defineExpose({ openExisting, openNew, close })
onBeforeUnmount(dispose)
</script>

<template>
  <div v-if="open" class="tab-group-editor-overlay" @click.self="close">
    <form ref="panel" class="tab-group-editor workspace-editor" role="dialog" aria-modal="true" aria-labelledby="tab-group-editor-title" :aria-busy="dismissBlocked" @submit.prevent="save">
      <header>
        <div><span class="eyebrow">{{ t('workspaceEditor.kicker') }}</span><h2 id="tab-group-editor-title">{{ mode === 'create' ? t('workspaceEditor.create') : t('workspaceEditor.edit') }}</h2></div>
        <div class="workspace-editor-header-actions">
          <span v-if="pendingMessage" class="workspace-editor-pending" role="status"><IconProgress class="state-spinner" aria-hidden="true" />{{ pendingMessage }}</span>
          <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('workspaceEditor.close')" :disabled="dismissBlocked" @click="close"><IconClose aria-hidden="true" /></UiButton>
        </div>
      </header>
      <div class="workspace-editor-body">
        <label for="tab-group-name">{{ t('workspaceEditor.name') }}</label>
        <input id="tab-group-name" v-model="name" type="text" maxlength="80" autocomplete="off" autofocus :disabled="dismissBlocked || (mode === 'edit' && isDefault)" />
        <label id="tab-group-color-label">{{ t('workspaceEditor.color') }}</label>
        <div class="tab-group-color-options" role="radiogroup" aria-labelledby="tab-group-color-label">
          <UiButton appearance="application"
            v-for="option in BROWSER_TAB_GROUP_COLORS"
            :key="option"
            class="tab-group-color-option"
            :class="{ selected: color === option }"
            :style="colorStyle(option)"
            type="button"
            role="radio"
            :aria-label="tabGroupColorLabel(option)"
            :aria-checked="color === option"
            :title="tabGroupColorLabel(option)"
            :disabled="dismissBlocked"
            @click="color = option"
          ><IconCheck v-if="color === option" aria-hidden="true" /></UiButton>
        </div>
        <section v-if="mode === 'create' || !isDefault" class="workspace-site-access-section">
          <div class="workspace-storage-heading"><IconShield aria-hidden="true" /><div><strong>{{ t('workspaceEditor.siteAccess') }}</strong><span>{{ t('workspaceEditor.siteAccessDescription') }}</span></div></div>
          <label class="workspace-storage-choice">
            <input v-model="navigationMode" type="radio" value="unrestricted" :disabled="dismissBlocked" />
            <span><strong>{{ t('workspaceEditor.unrestricted') }}</strong><small>{{ t('workspaceEditor.unrestrictedDescription') }}</small></span>
          </label>
          <label class="workspace-storage-choice">
            <input v-model="navigationMode" type="radio" value="restricted" :disabled="dismissBlocked" />
            <span><strong>{{ t('workspaceEditor.restricted') }}</strong><small>{{ t('workspaceEditor.restrictedDescription') }}</small></span>
          </label>
          <div v-if="navigationMode === 'restricted'" class="workspace-navigation-rules">
            <label for="workspace-navigation-rules">{{ t('workspaceEditor.allowedSites') }}</label>
            <textarea id="workspace-navigation-rules" v-model="navigationRulesText" rows="5" spellcheck="false" autocomplete="off" :placeholder="t('workspaceEditor.allowedSitesPlaceholder')" :disabled="dismissBlocked" />
            <small>{{ t('workspaceEditor.allowedSitesHelp') }}</small>
          </div>
          <details v-if="mode === 'edit'" class="workspace-navigation-audit">
            <summary>{{ t('workspaceEditor.blockedAttempts', { count: navigationAudit.length }) }}</summary>
            <p v-if="navigationAuditState === 'loading'">{{ t('workspaceEditor.auditLoading') }}</p>
            <p v-else-if="navigationAuditState === 'error'" class="error">{{ t('workspaceEditor.auditError') }}</p>
            <p v-else-if="!navigationAudit.length">{{ t('workspaceEditor.auditEmpty') }}</p>
            <ol v-else>
              <li v-for="entry in navigationAudit" :key="entry.id"><strong>{{ entry.targetOrigin }}</strong><span>{{ formatAuditTime(entry.timestamp) }} · {{ auditReasonLabel(entry.reason) }} · {{ auditSourceLabel(entry.source) }}</span></li>
            </ol>
          </details>
        </section>
        <section v-if="mode === 'create'" class="workspace-storage-section">
          <div class="workspace-storage-heading"><IconDatabase aria-hidden="true" /><div><strong>{{ t('workspaceEditor.startingData') }}</strong><span>{{ t('workspaceEditor.startingDescription') }}</span></div></div>
          <label class="workspace-storage-choice">
            <input v-model="storageMode" type="radio" value="scratch" :disabled="dismissBlocked" />
            <span><strong>{{ t('workspaceEditor.scratch') }}</strong><small>{{ t('workspaceEditor.scratchDescription') }}</small></span>
          </label>
          <label class="workspace-storage-choice">
            <input v-model="storageMode" type="radio" value="fork-default" :disabled="dismissBlocked" />
            <span><strong>{{ t('workspaceEditor.fork') }}</strong><small>{{ t('workspaceEditor.forkDescription') }}</small></span>
          </label>
          <div v-if="storageMode === 'fork-default'" class="workspace-origin-picker">
            <div><strong>{{ t('workspaceEditor.websites') }}</strong><UiButton appearance="application" type="button" :disabled="dismissBlocked" @click="toggleAllOrigins">{{ selectedOrigins.length === originOptions.length ? t('workspaceEditor.clear') : t('workspaceEditor.selectAll') }}</UiButton></div>
            <p v-if="storageState === 'loading'">{{ t('workspaceEditor.loading') }}</p>
            <p v-else-if="storageState === 'error'" class="error" role="alert">{{ storageMessage }}</p>
            <p v-else-if="!originOptions.length">{{ t('workspaceEditor.noOrigins') }}</p>
            <label v-for="origin in originOptions" :key="origin"><input v-model="selectedOrigins" type="checkbox" :value="origin" :disabled="dismissBlocked" /><span>{{ origin }}</span></label>
          </div>
        </section>
        <p v-else-if="isDefault" class="workspace-default-note"><IconKeep aria-hidden="true" /> {{ t('workspaceEditor.defaultDescription') }}</p>
        <section v-else class="workspace-storage-section">
          <div class="workspace-storage-heading"><IconDatabase aria-hidden="true" /><div><strong>{{ t('workspaceEditor.browserData') }}</strong><span>{{ t('workspaceEditor.browserDataDescription') }}</span></div></div>
          <div class="workspace-transfer-direction" role="radiogroup" :aria-label="t('workspaceEditor.transferDirection')">
            <label><input v-model="transferDirection" type="radio" value="from-default" :disabled="dismissBlocked" /><span>{{ t('workspaceEditor.importDefault') }}</span></label>
            <label><input v-model="transferDirection" type="radio" value="to-default" :disabled="dismissBlocked" /><span>{{ t('workspaceEditor.saveDefault') }}</span></label>
          </div>
          <div class="workspace-origin-picker">
            <div><strong>{{ t('workspaceEditor.websites') }}</strong><UiButton appearance="application" type="button" :disabled="dismissBlocked" @click="toggleAllOrigins">{{ selectedOrigins.length === originOptions.length ? t('workspaceEditor.clear') : t('workspaceEditor.selectAll') }}</UiButton></div>
            <p v-if="storageState === 'loading'">{{ t('workspaceEditor.loading') }}</p>
            <p v-else-if="!originOptions.length">{{ t('workspaceEditor.noSourceOrigins') }}</p>
            <label v-for="origin in originOptions" :key="origin"><input v-model="selectedOrigins" type="checkbox" :value="origin" :disabled="dismissBlocked" /><span>{{ origin }}</span></label>
          </div>
          <UiButton appearance="application" class="workspace-transfer-button" type="button" :disabled="actionPending || storageState === 'saving' || storageState === 'loading' || storageState === 'error'" @click="transferStorage"><IconSwapHoriz aria-hidden="true" /> {{ storageState === 'saving' ? t('workspaceEditor.copying') : transferDirection === 'from-default' ? t('workspaceEditor.importSelected') : t('workspaceEditor.saveSelected') }}</UiButton>
          <output v-if="storageMessage" :class="{ error: storageState === 'error' }" role="status">{{ storageMessage }}</output>
          <div class="workspace-danger-zone"><div><strong>{{ t('workspaceEditor.closePermanently') }}</strong><span>{{ t('workspaceEditor.closeDescription') }}</span></div><UiButton appearance="application" type="button" :disabled="dismissBlocked || state.allHumanInteractionLocked" :title="state.allHumanInteractionLocked ? t('workspaceEditor.unlockTitle') : undefined" data-lock-protected-tab-close @click="closeWorkspace">{{ t('workspaceEditor.closeWorkspace') }}</UiButton></div>
        </section>
        <output v-if="error" class="workspace-editor-error" role="alert">{{ error }}</output>
      </div>
      <footer><UiButton appearance="application" type="button" :disabled="dismissBlocked" @click="close">{{ t('workspaceEditor.cancel') }}</UiButton><UiButton appearance="application" variant="primary" class="primary" type="submit" :disabled="saveDisabled"><IconProgress v-if="actionPending" class="state-spinner" aria-hidden="true" />{{ mode === 'create' ? t('workspaceEditor.create') : t('workspaceEditor.save') }}</UiButton></footer>
    </form>
  </div>
</template>
