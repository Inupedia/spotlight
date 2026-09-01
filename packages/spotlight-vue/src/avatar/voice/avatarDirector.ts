import type { SpotlightVoicePhase } from "@inupedia/spotlight-protocol";

export function directorPhaseFromTurn(input: {
  loading: boolean;
  speaking: boolean;
  toolRunning: boolean;
  interrupted?: boolean;
}): SpotlightVoicePhase {
  if (input.interrupted) return "interrupted";
  if (input.speaking) return "speaking";
  if (input.toolRunning) return "tool-running";
  if (input.loading) return "thinking";
  return "listening";
}
