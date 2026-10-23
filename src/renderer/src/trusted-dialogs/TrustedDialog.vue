<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconWorkspacesOutline from '~icons/material-symbols/workspaces-outline'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import { trustedDialogCopy } from './trusted-dialog-copy.js'
import type { TrustedDialogController } from './useTrustedDialogController.js'

const props = defineProps<{ controller: TrustedDialogController }>()
const { t } = useI18n({ useScope: 'global' })
const translate = (key: MessageKey, parameters?: MessageParameters): string => t(key, parameters ?? {})

const request = computed(() => props.controller.request.value)
const copy = computed(() => request.value ? trustedDialogCopy(request.value, translate) : null)
const headlineText = computed(() => {
  const headline = copy.value?.headline
  return headline ? `${headline.before}${headline.emphasis}${headline.after}` : ''
})

/**
 * A dialog takes no answer until it has been on screen for a moment: a website can time a request so that a click
 * or key aimed at its page lands on Allow the instant the dialog appears. The window must be visible meanwhile, so
 * the click that brings a hidden window back does not answer either.
 */
const ARM_DELAY_MS = 500
const armedId = ref<string>()
let armTimer: ReturnType<typeof setTimeout> | undefined
const armed = computed(() => Boolean(request.value && armedId.value === request.value.id))

function disarm(): void {
  if (armTimer !== undefined) clearTimeout(armTimer)
  armTimer = undefined
  armedId.value = undefined
}

function arm(): void {
  disarm()
  const id = request.value?.id
  if (!id || document.visibilityState !== 'visible') return
  armTimer = setTimeout(() => {
    armTimer = undefined
    if (request.value?.id === id) armedId.value = id
  }, ARM_DELAY_MS)
}

const defaultButton = ref<{ focus(options?: { preventScroll?: boolean }): void } | null>(null)
function setButtonRef(index: number, element: unknown): void {
  if (index === request.value?.defaultId) defaultButton.value = element as typeof defaultButton.value
}

watch(() => request.value?.id, async (id) => {
  arm()
  if (!id) return
  // The next dialog in the queue replaces this one in place, so the focus moves to its safe button too.
  await nextTick()
  if (request.value?.id === id) defaultButton.value?.focus({ preventScroll: true })
}, { immediate: true })

function visibilityChanged(): void {
  if (document.visibilityState === 'visible') arm()
  else disarm()
}
document.addEventListener('visibilitychange', visibilityChanged)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', visibilityChanged)
  disarm()
})

/** A key held since before the dialog opened, such as Enter on the page, repeats; it never presses a button here. */
function ignoreHeldKeys(event: KeyboardEvent): void {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function choose(index: number): void {
  const current = request.value
  if (!current || !armed.value) return
  props.controller.respond(current.id, index)
}

function openChanged(open: boolean): void {
  if (!open) props.controller.cancel()
}

function buttonVariant(index: number): 'primary' | 'secondary' {
  return index === request.value?.primaryId ? 'primary' : 'secondary'
}
</script>

<template>
  <UiDialog
    :open="Boolean(request && copy)"
    :title="headlineText"
    :description="copy?.description"
    role="alertdialog"
    :close-label="t('trustedDialogs.close')"
    :close-on-backdrop="false"
    class="trusted-dialog"
    :class="[`trusted-dialog--${copy?.tone ?? 'info'}`, { 'trusted-dialog--arming': !armed }]"
    data-testid="trusted-dialog"
    :data-variant="request?.variant.kind"
    :data-request-id="request?.id"
    :data-armed="armed ? 'true' : 'false'"
    @update:open="openChanged"
    @keydown.capture="ignoreHeldKeys"
  >
    <template #icon><component :is="copy.icon" v-if="copy" class="trusted-dialog__icon" /></template>
    <template #eyebrow><span v-if="copy?.eyebrow" class="trusted-dialog__eyebrow">{{ copy.eyebrow }}</span></template>
    <template #title>
      <template v-if="copy">{{ copy.headline.before }}<strong v-if="copy.headline.emphasis" class="trusted-dialog__origin">{{ copy.headline.emphasis }}</strong>{{ copy.headline.after }}</template>
    </template>
    <div v-if="copy && (copy.quoted || copy.lines.length || copy.workspaceLine)" class="trusted-dialog__details">
      <figure v-if="copy.quoted" class="trusted-dialog__quoted">
        <figcaption v-if="copy.quotedLabel">{{ copy.quotedLabel }}</figcaption>
        <code data-testid="trusted-dialog-quoted">{{ copy.quoted }}</code>
      </figure>
      <p v-if="copy.workspaceLine" class="trusted-dialog__workspace">
        <IconWorkspacesOutline aria-hidden="true" />
        <span>{{ copy.workspaceLine }}</span>
      </p>
      <p v-for="(line, index) in copy.lines" :key="index" class="trusted-dialog__line">{{ line }}</p>
    </div>
    <template #footer>
      <UiButton
        v-for="(label, index) in request?.buttons ?? []"
        :key="`${request?.id}:${index}`"
        :ref="(element) => setButtonRef(index, element)"
        :variant="buttonVariant(index)"
        :autofocus="index === request?.defaultId || undefined"
        :aria-disabled="!armed || controller.answering.value || undefined"
        :data-response="index"
        @click="choose(index)"
      >
        {{ label }}
      </UiButton>
    </template>
  </UiDialog>
</template>
