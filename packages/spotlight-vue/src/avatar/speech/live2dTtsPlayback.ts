import { wavEnvelopeFromAudioBuffer, type WavEnvelope } from "../spine/spineLipSync.js";

/** 段与段之间追加的静音，避免下一段硬切进来。 */
export const TTS_CLIP_SILENCE_MS = 160;

type AudioContextCtor = typeof AudioContext;

let ttsPlaybackContext: AudioContext | null = null;
let currentTtsSource: AudioBufferSourceNode | null = null;

function audioContextCtor(): AudioContextCtor {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) {
    throw new Error("当前浏览器不支持 Web Audio");
  }
  return Ctor;
}

export function getTtsPlaybackContext(): AudioContext {
  if (!ttsPlaybackContext || ttsPlaybackContext.state === "closed") {
    ttsPlaybackContext = new (audioContextCtor())();
  }
  return ttsPlaybackContext;
}

export function ttsSilenceSampleCount(
  sampleRate: number,
  silenceMs = TTS_CLIP_SILENCE_MS,
): number {
  return Math.max(0, Math.round((Math.max(0, silenceMs) / 1000) * sampleRate));
}

export function appendSilenceToAudioBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  silenceMs = TTS_CLIP_SILENCE_MS,
): AudioBuffer {
  const extra = ttsSilenceSampleCount(buffer.sampleRate, silenceMs);
  if (extra <= 0) return buffer;
  const out = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length + extra,
    buffer.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    out.getChannelData(channel).set(buffer.getChannelData(channel));
  }
  return out;
}

export type DecodedTtsAudio = {
  audioBuffer: AudioBuffer;
  envelope: WavEnvelope;
};

export async function decodeTtsAudioFromBlob(blob: Blob): Promise<DecodedTtsAudio> {
  const ctx = getTtsPlaybackContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  const audioBuffer = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
  return {
    audioBuffer,
    envelope: wavEnvelopeFromAudioBuffer(audioBuffer),
  };
}

export function stopTtsBufferPlayback(): void {
  const source = currentTtsSource;
  currentTtsSource = null;
  if (!source) return;
  source.onended = null;
  try {
    source.stop();
  } catch {
    /* already stopped */
  }
  try {
    source.disconnect();
  } catch {
    /* ignore */
  }
}

export async function playTtsAudioBuffer(
  audioBuffer: AudioBuffer,
  signal?: AbortSignal,
  options?: {
    onStart?: (getElapsedMs: () => number) => void;
  },
): Promise<void> {
  const ctx = getTtsPlaybackContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  stopTtsBufferPlayback();

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  currentTtsSource = source;

  const startedAt = ctx.currentTime;
  const getElapsedMs = () => Math.max(0, (ctx.currentTime - startedAt) * 1000);
  options?.onStart?.(getElapsedMs);

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (currentTtsSource === source) {
        currentTtsSource = null;
      }
      resolve();
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (currentTtsSource === source) {
        stopTtsBufferPlayback();
      }
      reject(err);
    };

    const onAbort = () => fail(new DOMException("Aborted", "AbortError"));

    const cleanup = () => {
      source.onended = null;
      signal?.removeEventListener("abort", onAbort);
    };

    source.onended = () => finish();
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      source.start();
    } catch (err) {
      fail(err);
    }
  });
}
