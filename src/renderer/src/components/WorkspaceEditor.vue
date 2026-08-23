<script setup lang="ts">
import { onBeforeUnmount, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDatabase from '~icons/material-symbols/database-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconSwapHoriz from '~icons/material-symbols/swap-horiz-rounded'
import type { BrowserState } from '../../../shared/types.js'
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
  actionPending,
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
  confirm: (message) => window.confirm(message)
})

useModalDialogFocus({ open, panel, focusOnOpen: false })

function colorStyle(value: (typeof BROWSER_TAB_GROUP_COLORS)[number]): Record<string, string> {
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[value] }
}

defineExpose({ openExisting, openNew, close })
onBeforeUnmount(dispose)
</script>

<template>
  <div v-if="open" class="tab-group-editor-overlay" @click.self="close">
    <form ref="panel" class="tab-group-editor workspace-editor" role="dialog" aria-modal="true" aria-labelledby="tab-group-editor-title" @submit.prevent="save">
      <header>
        <div><span class="eyebrow">{{ t('workspaceEditor.kicker') }}</span><h2 id="tab-group-editor-title">{{ mode === 'create' ? t('workspaceEditor.create') : t('workspaceEditor.edit') }}</h2></div>
        <button class="panel-close" type="button" :aria-label="t('workspaceEditor.close')" @click="close"><IconClose aria-hidden="true" /></button>
      </header>
      <div class="workspace-editor-body">
        <label for="tab-group-name">{{ t('workspaceEditor.name') }}</label>
        <input id="tab-group-name" v-model="name" type="text" maxlength="80" autocomplete="off" autofocus :disabled="actionPending || (mode === 'edit' && isDefault)" />
        <label id="tab-group-color-label">{{ t('workspaceEditor.color') }}</label>
        <div class="tab-group-color-options" role="radiogroup" aria-labelledby="tab-group-color-label">
          <button
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
            :disabled="actionPending"
            @click="color = option"
          ><IconCheck v-if="color === option" aria-hidden="true" /></button>
        </div>
        <section v-if="mode === 'create'" class="workspace-storage-section">
          <div class="workspace-storage-heading"><IconDatabase aria-hidden="true" /><div><strong>{{ t('workspaceEditor.startingData') }}</strong><span>{{ t('workspaceEditor.startingDescription') }}</span></div></div>
          <label class="workspace-storage-choice">
            <input v-model="storageMode" type="radio" value="scratch" :disabled="actionPending" />
            <span><strong>{{ t('workspaceEditor.scratch') }}</strong><small>{{ t('workspaceEditor.scratchDescription') }}</small></span>
          </label>
          <label class="workspace-storage-choice">
            <input v-model="storageMode" type="radio" value="fork-default" :disabled="actionPending" />
            <span><strong>{{ t('workspaceEditor.fork') }}</strong><small>{{ t('workspaceEditor.forkDescription') }}</small></span>
          </label>
          <div v-if="storageMode === 'fork-default'" class="workspace-origin-picker">
            <div><strong>{{ t('workspaceEditor.websites') }}</strong><button type="button" @click="toggleAllOrigins">{{ selectedOrigins.length === originOptions.length ? t('workspaceEditor.clear') : t('workspaceEditor.selectAll') }}</button></div>
            <p v-if="storageState === 'loading'">{{ t('workspaceEditor.loading') }}</p>
            <p v-else-if="storageState === 'error'" class="error" role="alert">{{ storageMessage }}</p>
            <p v-else-if="!originOptions.length">{{ t('workspaceEditor.noOrigins') }}</p>
            <label v-for="origin in originOptions" :key="origin"><input v-model="selectedOrigins" type="checkbox" :value="origin" :disabled="actionPending" /><span>{{ origin }}</span></label>
          </div>
        </section>
        <p v-else-if="isDefault" class="workspace-default-note"><IconKeep aria-hidden="true" /> {{ t('workspaceEditor.defaultDescription') }}</p>
        <section v-else class="workspace-storage-section">
          <div class="workspace-storage-heading"><IconDatabase aria-hidden="true" /><div><strong>{{ t('workspaceEditor.browserData') }}</strong><span>{{ t('workspaceEditor.browserDataDescription') }}</span></div></div>
          <div class="workspace-transfer-direction" role="radiogroup" :aria-label="t('workspaceEditor.transferDirection')">
            <label><input v-model="transferDirection" type="radio" value="from-default" :disabled="actionPending || storageState === 'saving'" /><span>{{ t('workspaceEditor.importDefault') }}</span></label>
            <label><input v-model="transferDirection" type="radio" value="to-default" :disabled="actionPending || storageState === 'saving'" /><span>{{ t('workspaceEditor.saveDefault') }}</span></label>
          </div>
          <div class="workspace-origin-picker">
            <div><strong>{{ t('workspaceEditor.websites') }}</strong><button type="button" @click="toggleAllOrigins">{{ selectedOrigins.length === originOptions.length ? t('workspaceEditor.clear') : t('workspaceEditor.selectAll') }}</button></div>
            <p v-if="storageState === 'loading'">{{ t('workspaceEditor.loading') }}</p>
            <p v-else-if="!originOptions.length">{{ t('workspaceEditor.noSourceOrigins') }}</p>
            <label v-for="origin in originOptions" :key="origin"><input v-model="selectedOrigins" type="checkbox" :value="origin" :disabled="actionPending || storageState === 'saving'" /><span>{{ origin }}</span></label>
          </div>
          <button class="workspace-transfer-button" type="button" :disabled="actionPending || storageState === 'saving' || storageState === 'loading' || storageState === 'error'" @click="transferStorage"><IconSwapHoriz aria-hidden="true" /> {{ storageState === 'saving' ? t('workspaceEditor.copying') : transferDirection === 'from-default' ? t('workspaceEditor.importSelected') : t('workspaceEditor.saveSelected') }}</button>
          <output v-if="storageMessage" :class="{ error: storageState === 'error' }" role="status">{{ storageMessage }}</output>
          <div class="workspace-danger-zone"><div><strong>{{ t('workspaceEditor.closePermanently') }}</strong><span>{{ t('workspaceEditor.closeDescription') }}</span></div><button type="button" :disabled="actionPending || storageState === 'saving' || state.allHumanInteractionLocked" :title="state.allHumanInteractionLocked ? t('workspaceEditor.unlockTitle') : undefined" data-lock-protected-tab-close @click="closeWorkspace">{{ t('workspaceEditor.closeWorkspace') }}</button></div>
        </section>
        <output v-if="error" class="workspace-editor-error" role="alert">{{ error }}</output>
      </div>
      <footer><button type="button" @click="close">{{ t('workspaceEditor.cancel') }}</button><button class="primary" type="submit" :disabled="saveDisabled">{{ mode === 'create' ? t('workspaceEditor.create') : t('workspaceEditor.save') }}</button></footer>
    </form>
  </div>
</template>
