<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import type { BrowserTabState } from '../../../shared/types.js'
import { PAGE_DESTROYED_REASON } from '../../../shared/types/page-problems.js'
import type { ShownPagePane } from '../composables/useActiveTabPresentationController.js'

const props = defineProps<{
  tab: BrowserTabState
  /** The split view's pane the page is shown in, which the bar names so that the person knows which page it is about. */
  pane?: ShownPagePane
  details: (tab: BrowserTabState) => string
}>()

const emit = defineEmits<{ retry: []; proceed: [] }>()
const { t } = useI18n({ useScope: 'global' })
const detail = computed(() => props.details(props.tab))
const PANE_KEYS: Record<ShownPagePane, string> = {
  left: 'pageProblem.leftPage',
  right: 'pageProblem.rightPage',
  top: 'pageProblem.topPage',
  bottom: 'pageProblem.bottomPage'
}
const paneName = computed(() => props.pane ? t(PANE_KEYS[props.pane]) : '')
// A page gone for good loads nowhere again: the bar says to close the tab and reopen it, with nothing to try again.
const canRetry = computed(() => props.tab.pageProblem?.reason !== PAGE_DESTROYED_REASON)
</script>

<template>
  <div v-if="tab.pageProblem" class="page-problem-bar" role="alert" aria-live="assertive">
    <span class="page-problem-mark" aria-hidden="true"><IconError /></span>
    <span class="page-problem-copy">
      <span v-if="paneName" class="page-problem-pane">{{ paneName }}</span>
      <strong>{{ tab.pageProblem.title }}</strong>
      <span>{{ tab.pageProblem.message }}</span>
      <code v-if="detail">{{ detail }}</code>
    </span>
    <!-- Only the person can open a page whose certificate the tab refused; main asks them to confirm first. -->
    <UiButton v-if="tab.pageProblem.certificate?.canProceed" appearance="application" type="button" data-testid="page-problem-proceed" @click="emit('proceed')">
      {{ t('pageProblem.proceed', { host: tab.pageProblem.certificate.host }) }}
    </UiButton>
    <UiButton v-if="canRetry" appearance="application" type="button" @click="emit('retry')">
      <IconRefresh aria-hidden="true" />
      {{ tab.pageProblem.kind === 'unresponsive' ? t('pageProblem.reload') : t('pageProblem.tryAgain') }}
    </UiButton>
  </div>
</template>
