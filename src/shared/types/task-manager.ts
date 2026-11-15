/**
 * What a process of Hronaut's does, as Chrome's Task manager names it: the browser process, the GPU process, a
 * utility process such as the network service, Hronaut's own window, a process that runs pages of tabs, another page
 * process that runs no tab's page, such as a spare one Chromium keeps ready, and a helper such as Linux's zygote.
 */
export type TaskManagerProcessKind = 'browser' | 'gpu' | 'utility' | 'interface' | 'page' | 'other' | 'helper'

/** A frame of a tab's page that runs in another process than the page, by the tab and the frame's site. */
export interface TaskManagerSubframe {
  tabId: string
  /** The frame's origin, such as https://example.com, or empty when its address has none. */
  site: string
}

export interface TaskManagerProcess {
  /** The process's ID in the operating system. */
  pid: number
  kind: TaskManagerProcessKind
  /** Chromium's own name for a utility or helper process, such as Network Service; English, as Chrome shows it. */
  name?: string
  /** The tabs whose page runs in this process, in tab order. */
  tabIds: string[]
  /** Frames of tabs' pages that run here rather than in their page's process. */
  subframes: TaskManagerSubframe[]
  /** The tabs whose Developer Tools run in this process. */
  devToolsTabIds: string[]
  /** The memory the process uses, its working set, in bytes. */
  memoryBytes: number
  /** CPU use since the previous reading, in percent of one core, so a busy process can pass 100. */
  cpuPercent: number
  /** Whether End process can end it: it runs a tab's page that is awake, and nothing of Hronaut's own. */
  canEnd: boolean
}
