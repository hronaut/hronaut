/** A frame belongs to the document generation whose compositor produced it. */
export async function captureStableVideoImage<T>(
  capture: () => Promise<T>,
  generation: () => number,
  isLoading: () => boolean
): Promise<T | null> {
  if (isLoading()) return null
  const initialGeneration = generation()
  try {
    const image = await capture()
    return initialGeneration === generation() && !isLoading() ? image : null
  } catch (error) {
    // Chromium may reject with UnknownVizError while replacing its surface.
    // Retry on the next sampling tick only when navigation invalidated it.
    if (initialGeneration !== generation() || isLoading()) return null
    throw error
  }
}
