import { Application, Assets } from "pixi.js";
import { Spine } from "@pixi-spine/all-3.8";
import {
  MOUTH_SLOT,
  buildWavEnvelope,
  envelopeLevelAt,
  mouthAttachmentForLevel,
  type WavEnvelope,
} from "./spineLipSync.js";
import {
  resolveAvatarSkeletonUrl,
  type SpotlightAvatarConfig,
} from "../config.js";

export type { WavEnvelope } from "./spineLipSync.js";

const IDLE_ANIM = "idle";
const HELLO_ANIM = "hello";
/** 覆盖 idle 口型轨，保持 shuidi_3 微笑（见 public/little-drop/export/shuidi.json） */
const MOUTH_SMILE_ANIM = "mouth_smile";

let runtimeAvatarConfig: SpotlightAvatarConfig | undefined;

export function configureSpineAvatar(config?: SpotlightAvatarConfig): void {
  runtimeAvatarConfig = config;
}

let helloPlaying = false;
let helloResetTimer: number | null = null;

function clearHelloResetTimer(): void {
  if (helloResetTimer == null) return;
  window.clearTimeout(helloResetTimer);
  helloResetTimer = null;
}

let app: Application | null = null;
let spine: Spine | null = null;
let hostEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let spineUpdateWrapped = false;

let isSpeaking = false;
let lipSyncEnvelope: WavEnvelope | null = null;
/** 口型唯一时钟：TTS 播放已过去的毫秒 */
let lipSyncElapsedMs: (() => number) | null = null;
let lipSyncAnalyser: AnalyserNode | null = null;
let lipSyncAudioContext: AudioContext | null = null;

function setSlotAttachment(slotName: string, attachmentName: string): void {
  if (!spine) return;
  const skeleton = spine.skeleton;
  const slot = skeleton.findSlot(slotName);
  if (!slot) return;
  const attachment = skeleton.getAttachment(slot.data.index, attachmentName);
  slot.setAttachment(attachment ?? null);
}

function applyLipSyncMouth(): void {
  if (!spine) return;
  if (lipSyncAnalyser) {
    const data = new Uint8Array(lipSyncAnalyser.fftSize);
    lipSyncAnalyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
    setSlotAttachment(MOUTH_SLOT, mouthAttachmentForLevel(level));
    return;
  }
  if (!lipSyncEnvelope || !lipSyncElapsedMs) return;

  const elapsedMs = lipSyncElapsedMs();
  const level = envelopeLevelAt(lipSyncEnvelope, elapsedMs);
  setSlotAttachment(MOUTH_SLOT, mouthAttachmentForLevel(level));
}

function restoreIdleSmileTrack(): void {
  if (!spine?.state.hasAnimation(MOUTH_SMILE_ANIM)) return;
  spine.state.setAnimation(1, MOUTH_SMILE_ANIM, true);
}

function clearIdleSmileTrack(): void {
  if (!spine) return;
  spine.state.setEmptyAnimation(1, 0);
}

function playIdleWithSmile(): void {
  if (!spine) return;
  if (spine.state.hasAnimation(IDLE_ANIM)) {
    spine.state.setAnimation(0, IDLE_ANIM, true);
  }
  restoreIdleSmileTrack();
}

/** 开场招呼语时：hello 播一次，结束后自动接 idle（仅身体轨，嘴型由 TTS 音频驱动） */
export function playSpineHello(): void {
  if (!spine?.state.hasAnimation(HELLO_ANIM) || helloPlaying) return;
  clearHelloResetTimer();
  helloPlaying = true;
  const state = spine.state;
  state.setAnimation(0, HELLO_ANIM, false);
  if (state.hasAnimation(IDLE_ANIM)) {
    state.addAnimation(0, IDLE_ANIM, true, 0);
  }
  if (!isSpeaking) {
    restoreIdleSmileTrack();
  } else {
    clearIdleSmileTrack();
  }
  spine.update(0);

  const anim = state.data.skeletonData.findAnimation(HELLO_ANIM);
  const durationMs = anim ? (anim.duration + 0.15) * 1000 : 2500;
  helloResetTimer = window.setTimeout(() => {
    helloPlaying = false;
    helloResetTimer = null;
  }, durationMs);
}

function wrapSpineUpdate(): void {
  if (!spine || spineUpdateWrapped) return;
  const baseUpdate = spine.update.bind(spine);
  spine.update = (dt: number) => {
    baseUpdate(dt);
    if (!isSpeaking) return;
    if (!lipSyncAnalyser && (!lipSyncEnvelope || !lipSyncElapsedMs)) return;
    applyLipSyncMouth();
    baseUpdate(0);
  };
  spineUpdateWrapped = true;
}

const GROUND_SLOT = "shuidi_17";

function hideGroundSlot(): void {
  if (!spine) return;
  const slot = spine.skeleton.findSlot(GROUND_SLOT);
  if (slot) slot.setAttachment(null as never);
}

function layoutSpine(): void {
  if (!spine || !hostEl) return;
  const { clientWidth: w, clientHeight: h } = hostEl;
  if (w <= 0 || h <= 0) return;

  spine.scale.set(1);
  spine.position.set(0, 0);
  spine.update(0);

  const bounds = spine.getLocalBounds();
  if (bounds.width <= 0 || bounds.height <= 0) return;

  const pad = 0.9;
  const scale = Math.min((w * pad) / bounds.width, (h * pad) / bounds.height);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  spine.scale.set(scale);
  spine.position.set(w / 2 - cx * scale, h / 2 - cy * scale);
}

export async function startSpineAvatar(): Promise<void> {
  hostEl = document.getElementById("live2d-container");
  if (!hostEl || app) return;

  app = new Application({
    backgroundAlpha: 0,
    antialias: true,
    resizeTo: hostEl,
  });
  hostEl.appendChild(app.view as HTMLCanvasElement);

  const resource = await Assets.load(resolveAvatarSkeletonUrl(runtimeAvatarConfig));
  spine = new Spine(resource.spineData);
  spine.autoUpdate = true;
  wrapSpineUpdate();
  app.stage.addChild(spine as never);

  hideGroundSlot();
  playIdleWithSmile();
  spine.update(0);
  layoutSpine();

  resizeObserver = new ResizeObserver(() => layoutSpine());
  resizeObserver.observe(hostEl);
}

export function stopSpineAvatar(): void {
  stopSpineLipSync();
  clearHelloResetTimer();
  helloPlaying = false;
  resizeObserver?.disconnect();
  resizeObserver = null;
  spineUpdateWrapped = false;

  if (spine && app) {
    app.stage.removeChild(spine as never);
    spine.destroy({ children: true } as never);
    spine = null;
  }

  if (app) {
    app.destroy(true, { children: true, texture: true, baseTexture: true } as never);
    app = null;
  }

  hostEl = null;
  void Assets.reset();
}

/** 将口型与 TTS 播放时钟绑定（Web Audio 的 currentTime） */
export function bindSpineLipSyncToClock(
  getElapsedMs: () => number,
  envelope: WavEnvelope,
): void {
  if (!spine) return;
  stopMediaStreamLipSync();
  lipSyncElapsedMs = getElapsedMs;
  lipSyncEnvelope = envelope;
  clearIdleSmileTrack();
  isSpeaking = true;
  spine.update(0);
}

/** 将口型与指定 audio 元素绑定（须在 play() 前后均可，以 currentTime 为准） */
export function bindSpineLipSyncToAudio(
  audio: HTMLAudioElement,
  envelope: WavEnvelope,
): void {
  bindSpineLipSyncToClock(() => audio.currentTime * 1000, envelope);
}

export function bindSpineLipSyncToMediaStream(stream: MediaStream): void {
  if (!spine) return;
  stopMediaStreamLipSync();
  lipSyncElapsedMs = null;
  lipSyncEnvelope = null;
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  lipSyncAudioContext = context;
  lipSyncAnalyser = analyser;
  void context.resume();
  clearIdleSmileTrack();
  isSpeaking = true;
  spine.update(0);
}

export async function resumeSpineLipSyncAudio(): Promise<void> {
  if (lipSyncAudioContext?.state === "suspended") {
    await lipSyncAudioContext.resume();
  }
}

function stopMediaStreamLipSync(): void {
  lipSyncAnalyser = null;
  if (lipSyncAudioContext) {
    void lipSyncAudioContext.close();
    lipSyncAudioContext = null;
  }
}

/** 从音频 URL 解析包络并绑定（与 bindSpineLipSyncToAudio 二选一） */
export async function bindSpineLipSyncToAudioUrl(
  audio: HTMLAudioElement,
  audioUrl: string,
): Promise<void> {
  const envelope = await buildWavEnvelope(audioUrl);
  bindSpineLipSyncToAudio(audio, envelope);
}

export function stopSpineLipSync(): void {
  isSpeaking = false;
  lipSyncEnvelope = null;
  lipSyncElapsedMs = null;
  stopMediaStreamLipSync();
  restoreIdleSmileTrack();
  spine?.update(0);
}
