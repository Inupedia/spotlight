import { inject, type InjectionKey } from "vue";
import type { SpotlightVoiceConfig } from "@inupedia/spotlight-protocol";

export const SPOTLIGHT_VOICE_CONFIG_KEY: InjectionKey<SpotlightVoiceConfig> =
  Symbol("spotlight-voice-config");

export function useSpotlightVoiceConfig(): SpotlightVoiceConfig {
  return inject(SPOTLIGHT_VOICE_CONFIG_KEY, {});
}
