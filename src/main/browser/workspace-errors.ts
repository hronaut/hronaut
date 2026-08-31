export class RetainedBrowserWorkspaceError extends AggregateError {
  readonly workspaceId: string

  constructor(errors: Iterable<unknown>, workspaceId: string, message: string) {
    super(errors, message)
    this.name = 'RetainedBrowserWorkspaceError'
    this.workspaceId = workspaceId
  }
}
