<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import UiButton from './UiButton.vue'

export interface UiTabItem {
  id: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  items: UiTabItem[]
  label?: string
}>(), {
  label: 'Tabs'
})
const model = defineModel<string>({ required: true })
const tabList = ref<HTMLElement | null>(null)
const idPrefix = `ui-tabs-${useId()}`

function selectAt(index: number): void {
  const enabled = props.items.filter((item) => !item.disabled)
  if (!enabled.length) return
  const item = enabled[(index + enabled.length) % enabled.length]
  model.value = item.id
  void nextTick(() => {
    const tabs = [...(tabList.value?.querySelectorAll<HTMLElement>('[data-ui-tab]') ?? [])]
    tabs.find((tab) => tab.dataset.uiTab === item.id)?.focus()
  })
}

function move(direction: number): void {
  const enabled = props.items.filter((item) => !item.disabled)
  const current = Math.max(0, enabled.findIndex((item) => item.id === model.value))
  selectAt(current + direction)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight') move(1)
  else if (event.key === 'ArrowLeft') move(-1)
  else if (event.key === 'Home') selectAt(0)
  else if (event.key === 'End') selectAt(-1)
  else return
  event.preventDefault()
}
</script>

<template>
  <div class="ui-tabs">
    <div ref="tabList" class="ui-tabs__list" role="tablist" :aria-label="label" @keydown="onKeydown">
      <UiButton
        v-for="item in items"
        :id="`${idPrefix}-tab-${item.id}`"
        :key="item.id"
        class="ui-tabs__tab"
        variant="ghost"
        role="tab"
        :data-ui-tab="item.id"
        :aria-selected="model === item.id"
        :aria-controls="`${idPrefix}-panel-${item.id}`"
        :tabindex="model === item.id ? 0 : -1"
        :disabled="item.disabled"
        @click="model = item.id"
      >{{ item.label }}</UiButton>
    </div>
    <div
      :id="`${idPrefix}-panel-${model}`"
      class="ui-tabs__panel"
      role="tabpanel"
      :aria-labelledby="`${idPrefix}-tab-${model}`"
      tabindex="0"
    ><slot :active-id="model" /></div>
  </div>
</template>
