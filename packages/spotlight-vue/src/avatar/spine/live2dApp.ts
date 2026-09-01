import {
  bindSpineLipSyncToAudio,
  bindSpineLipSyncToAudioUrl,
  bindSpineLipSyncToClock,
  bindSpineLipSyncToMediaStream,
  playSpineHello,
  resumeSpineLipSyncAudio,
  startSpineAvatar,
  stopSpineAvatar,
  stopSpineLipSync,
  type WavEnvelope,
} from "./spineAvatar";

/** 数字人小滴（Spine / public/little-drop） */
export async function startLive2dApp(): Promise<void> {
  await startSpineAvatar();
}

export function stopLive2dApp(): void {
  stopSpineAvatar();
}

export function bindLive2dLipSyncToClock(
  getElapsedMs: () => number,
  envelope: WavEnvelope,
): void {
  bindSpineLipSyncToClock(getElapsedMs, envelope);
}

export function bindLive2dLipSyncToAudio(
  audio: HTMLAudioElement,
  envelope: WavEnvelope,
): void {
  bindSpineLipSyncToAudio(audio, envelope);
}

export async function bindLive2dLipSyncToAudioUrl(
  audio: HTMLAudioElement,
  audioUrl: string,
): Promise<void> {
  await bindSpineLipSyncToAudioUrl(audio, audioUrl);
}

export function bindLive2dLipSyncToMediaStream(stream: MediaStream): void {
  bindSpineLipSyncToMediaStream(stream);
}

export async function resumeLive2dLipSyncAudio(): Promise<void> {
  await resumeSpineLipSyncAudio();
}

export function stopLive2dLipSync(): void {
  stopSpineLipSync();
}

export type { WavEnvelope };

/** 与开场招呼语 TTS 同步时播放一次 hello 挥手（仅身体，嘴型跟 audio） */
export function playLive2dHello(): void {
  playSpineHello();
}
