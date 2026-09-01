import type { SpotlightVoiceConfig } from "@inupedia/spotlight-protocol";

export async function unlockVoicePlayback(): Promise<void> {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  const context = new Ctor();
  try {
    if (context.state === "suspended") await context.resume();
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function describeMicrophoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "NotAllowedError" || /permission|denied/i.test(message)) {
    return "请允许浏览器使用麦克风后再点一次。";
  }
  if (name === "NotFoundError" || /device not found|Requested device/i.test(message)) {
    return "没有找到麦克风，请检查设备后重试。";
  }
  if (name === "NotReadableError") {
    return "麦克风正被其他程序占用，请关闭后重试。";
  }
  if (/timed out|timeout/i.test(message)) {
    return "语音通道连接超时，请检查网络后重试。";
  }
  return "开麦失败，请再点一次。";
}

export function voiceConfigEnabled(config?: SpotlightVoiceConfig): boolean {
  return config?.enabled === true;
}
