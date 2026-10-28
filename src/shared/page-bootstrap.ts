import type { FixedDateBootstrap } from './fixed-date.js'
import type { ReactInspectionBootstrap } from './react-inspection.js'

/** What Hronaut installs in a top-level website document before its scripts run. */
export interface PageBootstrap {
  reactInspection: ReactInspectionBootstrap
  fixedDate: FixedDateBootstrap
}
