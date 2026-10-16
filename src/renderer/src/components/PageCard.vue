<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
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

// A request that names a tab lights that page; one for a whole workspace lights its pages, as the rail marks them.
function needsYou(card: PageCardGeometry): boolean {
  const request = props.userAttention
  if (!request) return false
  if (request.tabId) return card.tabId === request.tabId
  return Boolean(request.workspaceId) && props.tabs?.some((tab) => tab.id === card.tabId && tab.mcpGroupId === request.workspaceId) === true
}

// A new request on a lit page draws a new card, so its light swells again.
function cardKey(card: PageCardGeometry, index: number): string {
  return needsYou(card) ? `${index}:${props.userAttention!.id}` : String(index)
}

function px(value: number): string {
  return `${value}px`
}
</script>

<template>
  <div
    v-for="(card, index) in cards"
    :key="cardKey(card, index)"
    class="page-card"
    :class="{ 'needs-you': needsYou(card) }"
    data-testid="page-card"
    aria-hidden="true"
    :style="{ left: px(card.x), top: px(card.y), width: px(card.width), height: px(card.height) }"
  />
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
 * never on the page. It swells once over 2.4 s when it appears, then holds until the request ends.
 */
.page-card.needs-you {
  box-shadow: var(--page-card-shadow), 0 0 0 2px var(--needs-you), 0 0 10px 2px color-mix(in srgb, var(--needs-you) 40%, transparent);
  animation: page-card-handoff 2.4s ease-out;
}

@keyframes page-card-handoff {
  0% { box-shadow: var(--page-card-shadow), 0 0 0 2px var(--needs-you), 0 0 0 0 color-mix(in srgb, var(--needs-you) 0%, transparent); }
  35% { box-shadow: var(--page-card-shadow), 0 0 0 3px var(--needs-you), 0 0 22px 6px color-mix(in srgb, var(--needs-you) 60%, transparent); }
  100% { box-shadow: var(--page-card-shadow), 0 0 0 2px var(--needs-you), 0 0 10px 2px color-mix(in srgb, var(--needs-you) 40%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .page-card.needs-you { animation: none; }
}

/* High-contrast modes drop shadows; a system-colored outline marks the page instead. */
@media (forced-colors: active) {
  .page-card.needs-you { outline: 3px solid Highlight; outline-offset: 1px; }
}
</style>
