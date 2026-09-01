import { createVNode, render, type App } from "vue";
import {
  SPOTLIGHT_AVATAR_CONFIG_KEY,
  type SpotlightAvatarConfig,
} from "./avatar/config.js";
import type { SpotlightVuePluginOptions } from "./config.js";
import type { SpotlightVoiceConfig } from "@inupedia/spotlight-protocol";
import { SPOTLIGHT_VOICE_CONFIG_KEY } from "./avatar/voice/config.js";

let shellContainer: HTMLElement | null = null;

export async function mountSpotlightShell(
  app: App,
  options: SpotlightVuePluginOptions,
): Promise<void> {
  if (options.enabled === false) return;

  const avatarConfig: SpotlightAvatarConfig = {
    ...(options.avatar ?? {}),
  };
  app.provide(SPOTLIGHT_AVATAR_CONFIG_KEY, avatarConfig);
  const voiceConfig: SpotlightVoiceConfig = { ...(options.voice ?? {}) };
  app.provide(SPOTLIGHT_VOICE_CONFIG_KEY, voiceConfig);

  const { default: SpotlightShell } = await import(
    "./components/SpotlightShell.vue"
  );

  shellContainer = document.createElement("div");
  shellContainer.id = "inupedia-spotlight-root";
  document.body.appendChild(shellContainer);

  const vnode = createVNode(SpotlightShell, {
    avatarEnabled: options.avatarEnabled === true,
  });
  vnode.appContext = app._context;
  render(vnode, shellContainer);
}

export function unmountSpotlightShellForTests(): void {
  if (!shellContainer) return;
  render(null, shellContainer);
  shellContainer.remove();
  shellContainer = null;
}
