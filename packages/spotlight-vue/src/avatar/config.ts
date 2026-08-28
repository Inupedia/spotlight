import { inject, type InjectionKey } from "vue";

export type SpotlightAvatarConfig = {
  /** Show the digital-human voice surface as soon as Spotlight mounts. */
  initiallyVisible?: boolean;
  /** Base URL for Spine assets (defaults to `import.meta.env.BASE_URL`). */
  assetBaseUrl?: string;
  /** Skeleton JSON path relative to asset base (default: `little-drop/export/shuidi.json`). */
  skeletonJson?: string;
  greetingText?: string;
  bubbleTitle?: string;
  deckKicker?: string;
  briefingKeepLastMs?: number;
};

export const SPOTLIGHT_AVATAR_CONFIG_KEY: InjectionKey<SpotlightAvatarConfig> =
  Symbol("spotlight-avatar-config");

const DEFAULT_SKELETON = "little-drop/export/shuidi.json";

export function resolveAvatarAssetBase(config?: SpotlightAvatarConfig): string {
  const base = config?.assetBaseUrl?.trim();
  if (base) return base.endsWith("/") ? base : `${base}/`;
  const envBase =
    typeof import.meta !== "undefined"
      ? String(import.meta.env.BASE_URL ?? "/")
      : "/";
  return envBase.endsWith("/") ? envBase : `${envBase}/`;
}

export function resolveAvatarSkeletonUrl(config?: SpotlightAvatarConfig): string {
  const relative = config?.skeletonJson?.trim() || DEFAULT_SKELETON;
  const base = resolveAvatarAssetBase(config);
  return relative.startsWith("http") ? relative : `${base}${relative.replace(/^\//, "")}`;
}

export function useSpotlightAvatarConfig(): SpotlightAvatarConfig {
  return inject(SPOTLIGHT_AVATAR_CONFIG_KEY, {});
}
