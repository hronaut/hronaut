export type CommercialLicenseOperationCurrent = () => boolean

export class CommercialLicenseOperationCoordinator {
  private mutationQueue: Promise<void> = Promise.resolve()
  private mutationRevision = 0
  private refreshRevision = 0
  private pendingMutations = 0

  mutate<Value>(operation: () => Promise<Value>): Promise<Value> {
    this.pendingMutations += 1
    this.mutationRevision += 1
    this.refreshRevision += 1
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result.finally(() => {
      this.pendingMutations -= 1
    })
  }

  refresh<Value>(
    operation: (isCurrent: CommercialLicenseOperationCurrent) => Promise<Value>,
    skipped: () => Value | Promise<Value>
  ): Promise<Value> {
    if (this.pendingMutations > 0) return Promise.resolve(skipped())
    const startingMutationRevision = this.mutationRevision
    const operationRefreshRevision = ++this.refreshRevision
    const isCurrent = (): boolean => (
      this.pendingMutations === 0
      && this.mutationRevision === startingMutationRevision
      && this.refreshRevision === operationRefreshRevision
    )
    return operation(isCurrent)
  }
}
