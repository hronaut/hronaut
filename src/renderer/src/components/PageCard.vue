<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { PageCardGeometry } from '../../../shared/page-card.js'
import type { BrowserTabState, UserAttentionRequest } from '../../../shared/types.js'

const props = defineProps<{
  /** The open request for you: its page gets the handoff edge light until the request ends. */
  userAttention?: Pick<UserAttentionRequest, 'id' | 'tabId' | 'workspaceId'> | null
  tabs?: readonly Pick<BrowserTabState, 'id' | 'mcpGroupId'>[]
}>()

// The main process places the pages, so it says where their cards go: one per pane, in shell pixels.
const cards = ref<PageCardGeometry[]>([])
let changedBeforeRead = false
let disposed = false
const unsubscribe = window.hronautPageCard.onChanged((next) => {
  if (disposed) return
  changedBeforeRead = true
  cards.value = next
})
void window.hronautPageCard.get().then((initial) => {
  if (!disposed && !changedBeforeRead) cards.value = initial
}, () => undefined)
onBeforeUnmount(() => {
  disposed = true
  unsubscribe()
})

// A request that names a tab lights that page; one for a whole workspace lights its pages, as the rail marks that workspace.
const lit = computed(() => {
  const request = props.userAttention
  if (!request) return []
  return cards.value.filter((card) => card.tabId !== undefined && (request.tabId
    ? card.tabId === request.tabId
    : Boolean(request.workspaceId) && props.tabs?.some((tab) => tab.id === card.tabId && tab.mcpGroupId === request.workspaceId) === true))
})

function px(value: number): string {
  return `${value}px`
}
</script>

<template>
  <div
    v-for="(card, index) in cards"
    :key="index"
    class="page-card"
    data-testid="page-card"
    aria-hidden="true"
    :style="{ left: px(card.x), top: px(card.y), width: px(card.width), height: px(card.height) }"
  />
  <!-- The toolbar and the rail sit above the cards and hold the top and left gutters, so the light joins them in the shell's layer. -->
  <Teleport defer to=".shell">
    <div
      v-for="card in lit"
      :key="`${card.tabId}:${props.userAttention?.id}`"
      class="page-card-light"
      data-testid="page-card-light"
      aria-hidden="true"
      :style="{ left: px(card.x), top: px(card.y), width: px(card.width), height: px(card.height) }"
    />
  </Teleport>
</template>

<style scoped>
/* The page's native view, rounded to the same radius, covers the inside; only the edge and shadow show. */
.page-card {
  position: fixed;
  z-index: 0;
  pointer-events: none;
  border-radius: var(--page-card-radius);
  box-shadow: var(--page-card-shadow);
}

/*
 * The handoff edge light: an amber ring in the gutter around a page that needs you, drawn by the shell and
 * never on the page. Above the rail and toolbar, below docked panels, title bar and dialogs; a new request on a
 * lit page draws a new light, so it swells once over 2.4 s, then holds until the request ends.
 */
.page-card-light {
  position: fixed;
  z-index: 48;
  pointer-events: none;
  border-radius: var(--page-card-radius);
  box-shadow: 0 0 0 2px var(--needs-you), 0 0 8px 2px color-mix(in srgb, var(--needs-you) 35%, transparent);
  animation: page-card-handoff 2.4s ease-out;
}

@keyframes page-card-handoff {
  0% { box-shadow: 0 0 0 2px var(--needs-you), 0 0 0 0 color-mix(in srgb, var(--needs-you) 0%, transparent); }
  35% { box-shadow: 0 0 0 3px var(--needs-you), 0 0 14px 4px color-mix(in srgb, var(--needs-you) 55%, transparent); }
  100% { box-shadow: 0 0 0 2px var(--needs-you), 0 0 8px 2px color-mix(in srgb, var(--needs-you) 35%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .page-card-light { animation: none; }
}

/* High-contrast modes drop shadows; a system-colored outline marks the page instead. */
@media (forced-colors: active) {
  .page-card-light { outline: 3px solid Highlight; outline-offset: 1px; }
}
</style>
