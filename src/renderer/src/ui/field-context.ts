import type { ComputedRef, InjectionKey } from 'vue'

export interface UiFieldContext {
  controlId: ComputedRef<string>
  describedBy: ComputedRef<string | undefined>
  invalid: ComputedRef<boolean>
  required: ComputedRef<boolean>
  disabled: ComputedRef<boolean>
}

export const uiFieldContextKey: InjectionKey<UiFieldContext> = Symbol('ui-field')
