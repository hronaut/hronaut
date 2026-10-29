<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import type { BrowserTabState } from '../../../shared/types.js'

const props = defineProps<{
  tab: BrowserTabState
  details: (tab: BrowserTabState) => string
}>()

const emit = defineEmits<{ retry: []; proceed: [] }>()
const { t } = useI18n({ useScope: 'global' })
const detail = computed(() => props.details(props.tab))
</script>

<template>
  <div v-if="tab.pageProblem" class="page-problem-bar" role="alert" aria-live="assertive">
    <span class="page-problem-mark" aria-hidden="true"><IconError /></span>
    <span class="page-problem-copy">
      <strong>{{ tab.pageProblem.title }}</strong>
      <span>{{ tab.pageProblem.message }}</span>
      <code v-if="detail">{{ detail }}</code>
    </span>
    <!-- Only the person can open a page whose certificate the tab refused; main asks them to confirm first. -->
    <UiButton v-if="tab.pageProblem.certificate?.canProceed" appearance="application" type="button" data-testid="page-problem-proceed" @click="emit('proceed')">
      {{ t('pageProblem.proceed', { host: tab.pageProblem.certificate.host }) }}
    </UiButton>
    <UiButton appearance="application" type="button" @click="emit('retry')">
      <IconRefresh aria-hidden="true" />
      {{ tab.pageProblem.kind === 'unresponsive' ? t('pageProblem.reload') : t('pageProblem.tryAgain') }}
    </UiButton>
  </div>
</template>
