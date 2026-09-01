/** 嘴部 slot 与附件（shuidi_3 = 微笑，播报时按音量张大） */
export const MOUTH_SLOT = "shuidi_0";
export const MOUTH_SMILE = "shuidi_3";
export const MOUTH_OPEN_LEVELS = ["shuidi_3", "shuidi_2", "shuidi_1", "shuidi_0"] as const;

const LIP_SYNC_STEP_MS = 50;

export type WavEnvelope = {
  durationMs: number;
  levels: number[];
};

export async function buildWavEnvelope(wavUrl: string): Promise<WavEnvelope> {
  const response = await fetch(wavUrl);
  return buildWavEnvelopeFromBlob(await response.blob());
}

export function wavEnvelopeFromAudioBuffer(audioBuffer: AudioBuffer): WavEnvelope {
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const stepSamples = Math.max(1, Math.floor((sampleRate * LIP_SYNC_STEP_MS) / 1000));
  const levels: number[] = [];

  for (let i = 0; i < channel.length; i += stepSamples) {
    const end = Math.min(i + stepSamples, channel.length);
    let sum = 0;
    for (let j = i; j < end; j += 1) {
      const s = channel[j];
      sum += s * s;
    }
    levels.push(Math.sqrt(sum / (end - i)));
  }

  const peak = Math.max(...levels, 0.0001);
  return {
    durationMs: audioBuffer.duration * 1000,
    levels: levels.map((v) => Math.min(1, v / peak)),
  };
}

export async function buildWavEnvelopeFromBlob(blob: Blob): Promise<WavEnvelope> {
  const buffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    return wavEnvelopeFromAudioBuffer(audioBuffer);
  } finally {
    void ctx.close();
  }
}

export function envelopeLevelAt(
  envelope: WavEnvelope,
  elapsedMs: number,
): number {
  if (elapsedMs < 0) return 0;
  const idx = Math.floor(elapsedMs / LIP_SYNC_STEP_MS);
  if (idx >= envelope.levels.length) return 0;
  return envelope.levels[idx] ?? 0;
}

export function mouthAttachmentForLevel(level: number): string {
  const clamped = Math.max(0, Math.min(1, level));
  const idx = Math.min(
    MOUTH_OPEN_LEVELS.length - 1,
    Math.floor(clamped * MOUTH_OPEN_LEVELS.length),
  );
  return MOUTH_OPEN_LEVELS[idx];
}
