<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconFitScreen from '~icons/material-symbols/fit-screen-outline-rounded'
import IconScreenRotation from '~icons/material-symbols/screen-rotation-alt-rounded'
import UiIconButton from '../../ui/UiIconButton.vue'
import {
  useEmulationFrameController,
  type EmulationFrameControllerOptions
} from './useEmulationFrameController.js'
import { EMULATION_FRAME_CAPTION_SPACE, type EmulationFrameGeometry } from '../../../../shared/emulation-frame.js'

const props = defineProps<Omit<EmulationFrameControllerOptions, 'api'>>()
const { t, locale } = useI18n({ useScope: 'global' })
const { frames, pending, failed, run, dispose } = useEmulationFrameController({
  api: window.hronautEmulationFrame,
  setTabViewport: (tabId, viewport) => props.setTabViewport(tabId, viewport),
  syncState: (operation) => props.syncState(operation),
  beginMutation: () => props.beginMutation(),
  isMutationCurrent: (sequence) => props.isMutationCurrent(sequence),
  onApplied: (tabId) => props.onApplied(tabId)
})
onBeforeUnmount(dispose)

const BAR_HEIGHT = 32
const BAR_GAP = EMULATION_FRAME_CAPTION_SPACE - BAR_HEIGHT
// Shell pixels come from native pixels divided by the zoom factor, which can land a hair short.
const ROUNDING = 0.5
// A margin beside the page narrower than this cannot hold the side card's three buttons.
const SIDE_MIN = 112
const SIDE_MAX_WIDTH = 176

type BarPlacement = { side: boolean, style: Record<string, string> }

function number(value: number): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }).format(value)
}

function size(frame: EmulationFrameGeometry): string {
  return t('emulationFrame.size', { width: number(frame.viewport.width), height: number(frame.viewport.height) })
}

/** One line in the bar above or below the page; one line per part in the narrower card beside it. */
function caption(frame: EmulationFrameGeometry, side: boolean): string {
  const parts = [size(frame), t(frame.viewport.mobile ? 'emulationFrame.mobile' : 'emulationFrame.desktop')]
  if (frame.viewport.deviceScaleFactor !== 1) parts.push(t('emulationFrame.pixelRatio', { ratio: number(frame.viewport.deviceScaleFactor) }))
  return parts.join(side ? '\n' : ' · ')
}

function px(value: number): string {
  return `${value}px`
}

function areaStyle(frame: EmulationFrameGeometry): Record<string, string> {
  return { left: px(frame.area.x), top: px(frame.area.y), width: px(frame.area.width), height: px(frame.area.height) }
}

function outlineStyle(frame: EmulationFrameGeometry): Record<string, string> {
  return {
    left: px(frame.bounds.x - frame.area.x), top: px(frame.bounds.y - frame.area.y),
    width: px(frame.bounds.width), height: px(frame.bounds.height)
  }
}

/**
 * Above the page when there is room, then below it, then as a card beside it
 * when only the sides have room; with none, the toolbar's emulation chip remains.
 */
function barPlacement(frame: EmulationFrameGeometry): BarPlacement | null {
  const above = frame.bounds.y - frame.area.y
  const below = frame.area.y + frame.area.height - frame.bounds.y - frame.bounds.height
  const left = frame.bounds.x - frame.area.x
  const center = px(left + frame.bounds.width / 2)
  if (above + ROUNDING >= EMULATION_FRAME_CAPTION_SPACE) return { side: false, style: { left: center, top: px(above - EMULATION_FRAME_CAPTION_SPACE) } }
  if (below + ROUNDING >= EMULATION_FRAME_CAPTION_SPACE) return { side: false, style: { left: center, top: px(above + frame.bounds.height + BAR_GAP) } }
  if (left + ROUNDING >= SIDE_MIN) {
    const width = Math.min(SIDE_MAX_WIDTH, left - 2 * BAR_GAP)
    return { side: true, style: { left: px(left - BAR_GAP - width), top: px(above + BAR_GAP), width: px(width) } }
  }
  return null
}

const placements = computed(() => Object.fromEntries(frames.value.map((frame) => [frame.tabId, barPlacement(frame)])))
</script>

<template>
  <div v-for="frame in frames" :key="frame.tabId" class="emulation-frame" :style="areaStyle(frame)" data-testid="emulation-frame">
    <div class="emulation-frame-outline" :style="outlineStyle(frame)" />
    <div
      v-if="placements[frame.tabId]" class="emulation-frame-bar" :class="{ 'emulation-frame-bar-side': placements[frame.tabId]!.side }"
      :style="placements[frame.tabId]!.style" role="group" :aria-label="t('emulationFrame.label', { size: size(frame) })"
    >
      <span class="emulation-frame-caption">{{ caption(frame, placements[frame.tabId]!.side) }}</span>
      <span v-if="failed[frame.tabId]" class="emulation-frame-error" role="alert">{{ t('emulationFrame.failed') }}</span>
      <span class="emulation-frame-actions">
        <UiIconButton :label="t('emulationFrame.rotate')" :disabled="!!pending[frame.tabId]" :busy="pending[frame.tabId] === 'rotate'" @click="run(frame, 'rotate')">
          <IconScreenRotation aria-hidden="true" />
        </UiIconButton>
        <UiIconButton :label="t('emulationFrame.fit')" :disabled="!!pending[frame.tabId]" :busy="pending[frame.tabId] === 'fit'" @click="run(frame, 'fit')">
          <IconFitScreen aria-hidden="true" />
        </UiIconButton>
        <UiIconButton :label="t('emulationFrame.reset')" :disabled="!!pending[frame.tabId]" :busy="pending[frame.tabId] === 'reset'" @click="run(frame, 'reset')">
          <IconClose aria-hidden="true" />
        </UiIconButton>
      </span>
    </div>
  </div>
</template>

<style scoped>
.emulation-frame {
  position: fixed;
  z-index: 0;
  overflow: hidden;
  border-radius: var(--page-card-radius);
  -webkit-app-region: no-drag;
  background-color: var(--surface-muted);
  background-image: radial-gradient(color-mix(in srgb, var(--muted) 34%, transparent) 1px, transparent 1.4px);
  background-size: 14px 14px;
}
/* The page itself covers the inside; only the ring around it shows. */
.emulation-frame-outline {
  position: absolute;
  box-sizing: content-box;
  margin: -1px 0 0 -1px;
  border: 1px solid var(--border-strong);
  /* Around the page's rounded corners. */
  border-radius: calc(var(--page-card-radius) + 1px);
  box-shadow: var(--elevation-2);
}
.emulation-frame-bar {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  max-width: 100%;
  padding: 0 4px 0 12px;
  transform: translateX(-50%);
  border: 1px solid var(--border);
  border-radius: var(--corner-pill);
  background: var(--surface-raised);
  color: var(--text);
  font-size: var(--type-small-size);
  white-space: nowrap;
}
.emulation-frame-caption { margin-right: 6px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
.emulation-frame-error { margin-right: 6px; color: var(--danger-text); }
.emulation-frame-actions { display: flex; gap: 2px; }
/* Beside the page: the caption wraps above the actions. */
.emulation-frame-bar-side {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  height: auto;
  padding: 8px 6px 6px 10px;
  transform: none;
  border-radius: var(--corner-2);
  white-space: normal;
}
.emulation-frame-bar-side .emulation-frame-caption,
.emulation-frame-bar-side .emulation-frame-error { margin-right: 0; }
.emulation-frame-bar-side .emulation-frame-caption { white-space: pre-line; }
</style>
