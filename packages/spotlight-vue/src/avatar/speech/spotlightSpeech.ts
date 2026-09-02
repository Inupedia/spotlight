import {
  extractTranscriptionText,
  spotlightSynthesizeSpeech,
  spotlightTranscribeAudio,
} from "../../remote/audio.js";
import { getMicrophoneStream } from "../voice/micAccess.js";

const STT_MOCK_FALLBACK_TEXT = "请介绍一下引大济岷项目";

export type SpotlightTranscriptionResult = {
  text: string;
  raw: unknown;
};

function isSttMockMode(): boolean {
  // 仅本地开发可 mock；生产构建强制走真实麦克风 + STT 接口
  return import.meta.env.DEV && import.meta.env.VITE_STT_MOCK === "1";
}

function mockTranscriptionText(): string {
  const custom = import.meta.env.VITE_STT_MOCK_TEXT?.trim();
  return custom || STT_MOCK_FALLBACK_TEXT;
}

export function hasSpotlightSpeechConfig(): boolean {
  if (isSttMockMode()) return true;
  const key = import.meta.env.VITE_SPOTLIGHT_API_KEY?.trim();
  const base = import.meta.env.VITE_SPOTLIGHT_SERVER_URL?.trim();
  return Boolean(key && base);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** 浏览器侧录音 + mock；STT/TTS HTTP 见 `@inupedia/spotlight-vue`。 */
export class SpotlightSpeechService {
  private mediaRecorder: MediaRecorder | null = null;

  private mediaStream: MediaStream | null = null;

  private audioChunks: BlobPart[] = [];

  private started = false;

  get isRecording(): boolean {
    if (isSttMockMode()) return this.started;
    return this.mediaRecorder?.state === "recording";
  }

  async startRecording(): Promise<void> {
    if (isSttMockMode()) {
      if (this.started) return;
      this.started = true;
      return;
    }
    if (this.isRecording) return;
    this.audioChunks = [];
    this.mediaStream = await getMicrophoneStream();
    const mimeType = [
      "audio/ogg;codecs=opus",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    this.mediaRecorder = mimeType
      ? new MediaRecorder(this.mediaStream, { mimeType })
      : new MediaRecorder(this.mediaStream);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.audioChunks.push(event.data);
    };
    this.mediaRecorder.start();
    this.started = true;
  }

  async stopAndTranscribe(
    signal?: AbortSignal,
  ): Promise<SpotlightTranscriptionResult> {
    if (!this.started) {
      throw new Error("语音录制尚未开始。");
    }

    if (isSttMockMode()) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const text = mockTranscriptionText();
      this.reset();
      return { text, raw: { mock: true as const, text } };
    }

    if (!this.mediaRecorder) {
      throw new Error("语音录制尚未开始。");
    }

    const recorder = this.mediaRecorder;
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("语音录制失败，请重试。"));
      recorder.onstop = () => {
        resolve(
          new Blob(this.audioChunks, {
            type: recorder.mimeType || "audio/webm",
          }),
        );
      };
      recorder.stop();
    });
    this.stopTracks();

    if (blob.size <= 0) {
      throw new Error("未采集到语音内容，请重试。");
    }

    const filename = `spotlight-recording.${this.resolveFileExt(blob.type)}`;
    try {
      const raw = await spotlightTranscribeAudio(
        {
          file: await blobToBase64(blob),
          mimeType: blob.type || "audio/webm",
          filename,
        },
        signal,
      );
      const text = extractTranscriptionText(raw);
      if (!text) throw new Error("STT 返回为空，请重试。");
      return { text, raw };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Spotlight STT failed: ${message}`);
    } finally {
      this.reset();
    }
  }

  async synthesize(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; spokenText: string }> {
    try {
      return await spotlightSynthesizeSpeech(text, signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Spotlight TTS failed: ${message}`);
    }
  }

  cancel(): void {
    if (isSttMockMode()) {
      this.reset();
      return;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.stopTracks();
    this.reset();
  }

  private stopTracks(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private reset(): void {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.started = false;
  }

  private resolveFileExt(mimeType: string): string {
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("ogg")) return "ogg";
    return "webm";
  }
}
