export async function runBackgroundAction(
  action: string,
  callback: () => unknown,
  onFailure: (action: string, error: unknown) => void
): Promise<void> {
  try {
    await callback()
  } catch (error) {
    try {
      onFailure(action, error)
    } catch {
      // Background work has no caller to receive a second reporting failure.
      // The owning reporter is responsible for logging before notifying UI.
    }
  }
}
