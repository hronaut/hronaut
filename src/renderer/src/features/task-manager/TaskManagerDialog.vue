<script setup lang="ts">
import UiButton from '../../ui/UiButton.vue'
import UiIconButton from '../../ui/UiIconButton.vue'
import UiOverlayTransition from '../../ui/UiOverlayTransition.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconArrowDown from '~icons/material-symbols/arrow-downward-rounded'
import IconArrowUp from '~icons/material-symbols/arrow-upward-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconBrowseActivity from '~icons/material-symbols/browse-activity-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import type { BrowserTabState, TaskManagerProcess } from '../../../../shared/types.js'
import { ignoreHeldEnter } from '../../held-enter.js'
import { useModalDialogFocus } from '../../composables/useModalDialogFocus.js'
import type { TaskManagerController } from './useTaskManagerController.js'

type SortKey = 'task' | 'memory' | 'cpu' | 'pid'

interface TaskLine {
  label: string
  workspace?: string
}

interface TaskRow {
  process: TaskManagerProcess
  /** Its place in the list main gives, which the Task column sorts by. */
  order: number
  tasks: TaskLine[]
  /** The row's name for End process's label: its first task. */
  name: string
}

const props = defineProps<{
  controller: TaskManagerController
  tabs: BrowserTabState[]
  workspaces: Array<{ id: string; name: string }>
  formatBytes: (bytes: number) => string
  reportLayout: () => void
}>()

const { t, locale } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const { open, processes, state, error, ending, close, endProcess } = props.controller
const sortKey = ref<SortKey>('task')
const descending = ref(false)

const cpuFormat = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

const rows = computed<TaskRow[]>(() => {
  const tabs = new Map(props.tabs.map((tab) => [tab.id, tab]))
  const workspaces = new Map(props.workspaces.map((workspace) => [workspace.id, workspace.name]))
  // Each tab's workspace, when there are several to tell its tabs apart by.
  const workspaceOf = (tab: BrowserTabState | undefined): string | undefined => (
    props.workspaces.length > 1 && tab?.mcpGroupId ? workspaces.get(tab.mcpGroupId) : undefined
  )
  const titleOf = (tab: BrowserTabState | undefined): string => tab?.title || tab?.url || t('taskManager.untitled')
  const line = (label: string, tab?: BrowserTabState): TaskLine => {
    const workspace = workspaceOf(tab)
    return workspace ? { label, workspace } : { label }
  }
  return processes.value.map((process, order) => {
    const tasks: TaskLine[] = []
    if (process.kind === 'browser') tasks.push(line(t('taskManager.task.browser')))
    else if (process.kind === 'gpu') tasks.push(line(t('taskManager.task.gpu')))
    else if (process.kind === 'utility') tasks.push(line(process.name ? t('taskManager.task.utility', { name: process.name }) : t('taskManager.task.utilityUnnamed')))
    else if (process.kind === 'interface') tasks.push(line(t('taskManager.task.interface')))
    else if (process.kind === 'helper') tasks.push(line(t('taskManager.task.helper', { name: process.name ?? '' })))
    else if (process.kind === 'other') tasks.push(line(t('taskManager.task.other')))
    else {
      for (const tabId of process.tabIds) {
        const tab = tabs.get(tabId)
        tasks.push(line(t(tab?.sleeping ? 'taskManager.task.sleepingTab' : 'taskManager.task.tab', { title: titleOf(tab) }), tab))
      }
      for (const frame of process.subframes) {
        const tab = tabs.get(frame.tabId)
        tasks.push(line(frame.site ? t('taskManager.task.subframe', { site: frame.site }) : t('taskManager.task.subframeUnnamed'), tab))
      }
      for (const tabId of process.devToolsTabIds) {
        const tab = tabs.get(tabId)
        tasks.push(line(t('taskManager.task.devTools', { title: titleOf(tab) }), tab))
      }
      if (tasks.length === 0) tasks.push(line(t('taskManager.task.other')))
    }
    return { process, order, tasks, name: tasks[0].label }
  }).sort((left, right) => {
    const value = (row: TaskRow): number => sortKey.value === 'memory' ? row.process.memoryBytes
      : sortKey.value === 'cpu' ? row.process.cpuPercent
        : sortKey.value === 'pid' ? row.process.pid
          : row.order
    const difference = value(left) - value(right) || left.order - right.order
    return descending.value ? -difference : difference
  })
})

const summary = computed(() => {
  const count = processes.value.length
  const memory = processes.value.reduce((sum, process) => sum + process.memoryBytes, 0)
  return t('taskManager.summary', { count: new Intl.NumberFormat(locale.value).format(count), memory: props.formatBytes(memory) }, count)
})

/** Sorts by the column, the other way on a second click; memory and CPU start with the largest, as in Chrome. */
function sortBy(key: SortKey): void {
  if (sortKey.value === key) descending.value = !descending.value
  else {
    sortKey.value = key
    descending.value = key === 'memory' || key === 'cpu'
  }
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) return 'none'
  return descending.value ? 'descending' : 'ascending'
}

/**
 * Ends the row's process. Its button turns busy, and its row leaves once the process has gone, now or at a later
 * reading; either takes the focus off the button, so the focus moves to the dialog first rather than falling to the
 * page behind or to the next row's End process, which a held Enter would press.
 */
function endRowProcess(event: MouseEvent, pid: number): void {
  const dialog = panel.value
  if (dialog && event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement)) dialog.focus({ preventScroll: true })
  void endProcess(pid)
}

useModalDialogFocus({ open, panel, afterLayout: props.reportLayout })
</script>

<template>
  <UiOverlayTransition>
    <div v-if="open" class="settings-overlay task-manager-overlay" @click.self="close">
      <section
        ref="panel"
        class="task-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-manager-title"
        aria-describedby="task-manager-summary"
        tabindex="-1"
      >
        <header class="task-manager-header">
          <h2 id="task-manager-title">{{ t('taskManager.title') }}</h2>
          <UiIconButton class="panel-close" :label="t('taskManager.close')" @click="close"><IconClose aria-hidden="true" /></UiIconButton>
        </header>

        <div class="task-manager-content">
          <div v-if="state === 'loading'" class="task-manager-state" role="status">
            <IconProgress class="state-spinner" aria-hidden="true" />
            <span>{{ t('taskManager.loading') }}</span>
          </div>
          <div v-else-if="state === 'error'" class="task-manager-state error" role="alert">
            <IconBrowseActivity aria-hidden="true" />
            <strong>{{ t('taskManager.unavailable') }}</strong>
            <span>{{ error }}</span>
          </div>
          <table v-else class="task-manager-table">
            <caption class="sr-only">{{ t('taskManager.caption') }}</caption>
            <thead>
              <tr>
                <th
                  v-for="column in (['task', 'memory', 'cpu', 'pid'] as const)"
                  :key="column"
                  scope="col"
                  :class="`task-manager-column-${column}`"
                  :aria-sort="ariaSort(column)"
                >
                  <UiButton appearance="application" class="task-manager-sort" @click="sortBy(column)">
                    <span>{{ t(`taskManager.columns.${column}`) }}</span>
                    <template v-if="sortKey === column">
                      <IconArrowDown v-if="descending" aria-hidden="true" />
                      <IconArrowUp v-else aria-hidden="true" />
                    </template>
                  </UiButton>
                </th>
                <th scope="col" class="task-manager-column-actions"><span class="sr-only">{{ t('taskManager.columns.actions') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.process.pid" :data-task-manager-kind="row.process.kind">
                <th scope="row" class="task-manager-tasks">
                  <!-- Spaces between the parts, so the row's name reads as words rather than one run of text. -->
                  <span v-for="(task, index) in row.tasks" :key="index" class="task-manager-task">
                    <span class="task-manager-task-label">{{ task.label }}</span><template v-if="task.workspace">{{ ' ' }}<span class="task-manager-workspace">{{ task.workspace }}</span></template>{{ index < row.tasks.length - 1 ? ' ' : '' }}
                  </span>
                </th>
                <td class="task-manager-number">{{ formatBytes(row.process.memoryBytes) }}</td>
                <td class="task-manager-number">{{ cpuFormat.format(row.process.cpuPercent) }}</td>
                <td class="task-manager-number">{{ row.process.pid }}</td>
                <td class="task-manager-actions">
                  <UiButton
                    v-if="row.process.canEnd"
                    size="small"
                    class="task-manager-end"
                    :busy="ending === row.process.pid"
                    :disabled="ending !== null && ending !== row.process.pid"
                    :aria-label="t('taskManager.endProcessAria', { task: row.name })"
                    @keydown="ignoreHeldEnter"
                    @click="endRowProcess($event, row.process.pid)"
                  >{{ t('taskManager.endProcess') }}</UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="task-manager-footer">
          <span id="task-manager-summary">{{ summary }}</span>
          <span v-if="error && state !== 'error'" class="task-manager-error" role="alert">{{ error }}</span>
        </footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
