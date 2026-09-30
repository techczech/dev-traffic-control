/**
 * Finishing hands him the thing he needs next: the collect prompt, already on
 * the clipboard when the finished surface appears. The copy is a courtesy on
 * top of a completed write, so a rejected clipboard call costs the prompt and
 * never the finish — nothing here touches the report state or the save-error
 * path, and this adds to the manual control rather than replacing it.
 */
export async function copyCollectPromptAfterFinish(
  requestPath: string,
  title: string,
  showToast: (message: string) => void
): Promise<void> {
  try {
    await window.qa.copyCollectPrompt(requestPath, title)
    showToast('Collect prompt copied — paste it to the agent that asked.')
  } catch {
    showToast('Finished — the collect prompt could not be copied.')
  }
}
