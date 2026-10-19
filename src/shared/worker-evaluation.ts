/** Actions of browser_workers: list a tab's own dedicated workers, or evaluate a script in one of them. */
export const WORKER_EVALUATION_ACTIONS = ['list', 'evaluate'] as const
export type WorkerEvaluationAction = typeof WORKER_EVALUATION_ACTIONS[number]

export const WORKER_EVALUATION_LIMITS = {
  maxWorkers: 16,
  maxScriptChars: 200_000,
  maxResultChars: 100_000,
  maxHandleChars: 64,
  maxNameChars: 100,
  maxPathChars: 512,
  maxExceptionChars: 2_000,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000
} as const

export interface WorkerSummary {
  /** Opaque and short-lived: valid for this tab until its next listing, a navigation, a workspace control change or the worker ending. */
  handle: string
  /** The worker script's path on the page's origin, without query or fragment. */
  path: string
  /** The name the page gave the worker, when it gave one. Page-provided text, never authority. */
  name?: string
}

export interface WorkerListReport {
  action: 'list'
  tabId: string
  /** The page's origin, which every listed worker's script shares. */
  origin: string
  workers: WorkerSummary[]
  /** Dedicated workers Chromium reports for this page that are not listed, by why. */
  omitted: {
    /** Created by a frame inside the page rather than its top-level document. */
    frameWorkers: number
    /** Running a blob:, data: or other-origin script. */
    otherScripts: number
    /** Beyond the listing limit. */
    overLimit: number
  }
  caveats: string[]
}

/** How the script's value came back: as JSON, cut to the result limit, or not representable as JSON. */
export type WorkerEvaluationResultKind = 'json' | 'truncated' | 'undefined' | 'unserializable'

export interface WorkerEvaluationReport {
  action: 'evaluate'
  tabId: string
  worker: WorkerSummary
  resultKind: WorkerEvaluationResultKind
  /** With json: the script's value. */
  result?: unknown
  /** With truncated: the first characters of the value's JSON text. */
  resultPreview?: string
  /** With truncated: the length of the value's whole JSON text. */
  resultChars?: number
}

export const WORKER_EVALUATION_CAVEATS = [
  'Only dedicated workers that the top-level document created directly, from a script of its own origin, are listed. Shared and service workers, workers of frames, workers started by other workers, and blob: or data: workers are not.',
  'Listing and evaluation briefly attach Hronaut\'s debugger to the page\'s workers and detach them again; the workers keep running and are never paused, created or terminated.',
  'A script runs with the worker\'s full authority: it can change worker state, send requests and read values. Its output is bounded, and a script still running at its deadline is stopped without undoing what it already did.'
] as const
