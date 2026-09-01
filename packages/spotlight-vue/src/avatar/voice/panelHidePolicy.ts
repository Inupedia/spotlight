/** Text submit hides the command panel to show thinking. That is not a user cancel. */
export function shouldAbortVoiceOnPanelHide(state: {
  loading: boolean;
  pipelinePhase: string;
}): boolean {
  return !state.loading && state.pipelinePhase !== "running";
}
