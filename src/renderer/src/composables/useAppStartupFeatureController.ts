import {
  useAppBootstrapController,
  type AppBootstrapFailure,
  type AppBootstrapTask
} from './useAppBootstrapController.js'
import { disposeAll } from './dispose-all.js'
import { useStartupRecoveryController } from './useStartupRecoveryController.js'

export interface AppStartupFeatureControllerOptions {
  tasks: AppBootstrapTask[]
  onFailure: (failures: AppBootstrapFailure[]) => void
  retryDelayMs?: number
  maximumAttempts?: number
  onAttemptSettled?: () => void
  onRecovered?: () => void
}

export function useAppStartupFeatureController(options: AppStartupFeatureControllerOptions) {
  const bootstrap = useAppBootstrapController({
    tasks: options.tasks,
    onFailure: options.onFailure
  })
  const recovery = useStartupRecoveryController({
    initialize: bootstrap.initialize,
    retryDelayMs: options.retryDelayMs,
    maximumAttempts: options.maximumAttempts,
    onAttemptSettled: options.onAttemptSettled,
    onRecovered: options.onRecovered
  })

  function dispose(): void {
    disposeAll([recovery.dispose, bootstrap.dispose])
  }

  return {
    bootstrap,
    recovery,
    start: recovery.start,
    dispose
  }
}

export type AppStartupFeatureController = ReturnType<typeof useAppStartupFeatureController>
