/** Shared voice turn types for HTTP STT/TTS (browser ↔ Spotlight Server). */

export const SPOTLIGHT_VOICE_PHASES = [
  "idle",
  "listening",
  "thinking",
  "tool-running",
  "speaking",
  "interrupted",
  "error",
] as const;

export type SpotlightVoicePhase = (typeof SPOTLIGHT_VOICE_PHASES)[number];

export type SpotlightVoiceAbortReason =
  | "barge_in"
  | "escape"
  | "panel_close"
  | "avatar_close"
  | "mute"
  | "session_end"
  | "error"
  | "user"
  | "superseded";

export interface SpotlightVoiceConfig {
  enabled?: boolean;
}

export type SpotlightSpokenPhrase = {
  index: number;
  text: string;
  generation: number;
};

/** Sentence-ending only. Commas stay inside a clip so TTS cadence stays even. */
const SENTENCE_BOUNDARY = /[。！？!?\n]/u;

function hasTtsPipe(text: string): boolean {
  return /[|｜│¦]/u.test(text);
}

function countTtsPipes(text: string): number {
  return (text.match(/[|｜│¦]/gu) ?? []).length;
}

function normalizeTtsPipes(text: string): string {
  return text.replace(/[|｜│¦]/gu, "|");
}

export const SPOKEN_SENTENCE_MIN_CHARS = 24;
export const SPOKEN_SENTENCE_MAX_CHARS = 72;
export const SPOKEN_SENTENCE_MAX_COUNT = 6;

function splitTableCells(line: string): string[] {
  return normalizeTtsPipes(line)
    .replace(/^\s*\|/u, "")
    .replace(/\|\s*$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isDividerRow(line: string): boolean {
  const cells = splitTableCells(line);
  return (
    cells.length >= 2 &&
    cells.every((cell) => cell === "" || /^:?-{2,}:?$/u.test(cell))
  );
}

function isPipeRow(line: string): boolean {
  return countTtsPipes(line) >= 2 && !isDividerRow(line);
}

function speakTableRow(headers: string[], cells: string[]): string {
  const fragments: string[] = [];
  const count = Math.max(headers.length, cells.length);
  for (let index = 0; index < count; index += 1) {
    const header = (headers[index] ?? "").replace(/[*_`#]+/gu, "").trim();
    const value = (cells[index] ?? "").replace(/[*_`#]+/gu, "").trim();
    if (!value || value === "-") continue;
    fragments.push(header ? `${header}是${value}` : value);
  }
  return fragments.join("，");
}

/** Turn Markdown / GFM tables into spoken sentences. Never leave `|` for TTS. */
export function markdownTablesToSpeech(text: string): string {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const next = lines[index + 1];
    if (isPipeRow(line) && next !== undefined && isDividerRow(next)) {
      const headers = splitTableCells(line);
      index += 2;
      const spoken: string[] = [];
      while (index < lines.length && isPipeRow(lines[index] ?? "")) {
        const row = speakTableRow(headers, splitTableCells(lines[index] ?? ""));
        if (row) spoken.push(row);
        index += 1;
      }
      if (spoken.length > 0) output.push(`${spoken.join("。")}。`);
      continue;
    }
    if (isPipeRow(line)) {
      const row = speakTableRow([], splitTableCells(line));
      if (row) output.push(`${row}。`);
      index += 1;
      continue;
    }
    output.push(line);
    index += 1;
  }
  return output.join("\n");
}

export function sanitizeSpokenText(text: string): string {
  return markdownTablesToSpeech(text)
    .replace(/<table[\s\S]*?<\/table>/giu, " ")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/^\s*[-:| ]{3,}$/gmu, " ")
    .replace(/[#>*_~]+/gu, " ")
    .replace(/[|｜│¦]/gu, "，")
    .replace(/[<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s+([，,。！？、；：,.!?;:])/gu, "$1")
    .replace(/，{2,}/gu, "，")
    .replace(/^[，、\s]+|[，、\s]+$/gu, "")
    .trim();
}

export function stripMarkdownForSpeech(text: string): string {
  return sanitizeSpokenText(text);
}

/**
 * CosyVoice 常把生成文件的最后一个音素裁掉。
 * 空白会被模型丢掉，所以要追加会出停顿的省略号，让被裁掉的是垫字而不是正文最后一个字。
 * 不改屏幕文案。
 */
export function padSpokenTextForTts(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/……$/u.test(trimmed)) return trimmed;
  const closed = /[。！？!?]$/u.test(trimmed) ? trimmed : `${trimmed}。`;
  return `${closed}……`;
}

export function isSpeakableSentence(text: string): boolean {
  const cleaned = sanitizeSpokenText(text);
  return cleaned.length > 0 && !hasTtsPipe(cleaned);
}

function normalizePhrase(raw: string): string {
  const text = raw
    .replace(
      /^\s*(?:(?:\d+|[一二三四五六七八九十]+)[、.．)）]|[-*•])\s*/u,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return "";
  if (/[。！？!?]$/u.test(text)) return text;
  return `${text}。`;
}

export function packSpokenSentences(
  answer: string,
  options?: {
    minChars?: number;
    maxChars?: number;
    maxSentences?: number;
  },
): string[] {
  const minChars = options?.minChars ?? SPOKEN_SENTENCE_MIN_CHARS;
  const maxChars = options?.maxChars ?? SPOKEN_SENTENCE_MAX_CHARS;
  const maxSentences = Math.max(
    1,
    options?.maxSentences ?? SPOKEN_SENTENCE_MAX_COUNT,
  );
  const plain = stripMarkdownForSpeech(answer);
  if (!plain) return [];
  const raw =
    plain
      .match(/[^。！？!?\n]+[。！？!?]?/gu)
      ?.map(normalizePhrase)
      .filter(Boolean) ?? [];
  const packed: string[] = [];
  let buffer = "";
  for (const sentence of raw) {
    if (!buffer) {
      buffer = sentence;
      continue;
    }
    const merged = `${buffer}${sentence}`;
    if (merged.length <= maxChars) {
      buffer = merged;
      continue;
    }
    packed.push(buffer);
    if (packed.length >= maxSentences) {
      buffer = "";
      break;
    }
    buffer = sentence;
  }
  if (buffer) {
    const previous = packed[packed.length - 1];
    if (
      previous &&
      buffer.length < minChars &&
      previous.length + buffer.length <= maxChars * 2
    ) {
      packed[packed.length - 1] = `${previous}${buffer}`;
    } else if (packed.length < maxSentences) {
      packed.push(buffer);
    }
  }
  return packed.filter(isSpeakableSentence);
}

export function drainSpokenClips(
  held: string,
  options?: {
    force?: boolean;
    minChars?: number;
    maxChars?: number;
    maxSentences?: number;
  },
): { ready: string[]; rest: string } {
  const minChars = options?.minChars ?? SPOKEN_SENTENCE_MIN_CHARS;
  const clips = packSpokenSentences(held, {
    minChars,
    maxChars: options?.maxChars,
    maxSentences: options?.maxSentences,
  });
  if (clips.length === 0) return { ready: [], rest: "" };
  const last = clips[clips.length - 1] ?? "";
  if (!options?.force && last.length < minChars) {
    if (clips.length === 1) return { ready: [], rest: held };
    return { ready: clips.slice(0, -1), rest: last };
  }
  return { ready: clips, rest: "" };
}

export function splitSpokenPhrases(
  answer: string,
  maxPhrases = SPOKEN_SENTENCE_MAX_COUNT,
): string[] {
  return packSpokenSentences(answer, { maxSentences: maxPhrases });
}

export function takeSpokenPhrases(buffer: string): {
  phrases: string[];
  rest: string;
} {
  const phrases: string[] = [];
  let rest = buffer;
  while (true) {
    const index = rest.search(SENTENCE_BOUNDARY);
    if (index < 0) break;
    const phrase = rest.slice(0, index + 1).replace(/\s+/gu, " ").trim();
    rest = rest.slice(index + 1);
    if (phrase) phrases.push(phrase);
  }
  return { phrases, rest };
}

export function createSpokenPhraseSink(options?: {
  onPhrase?: (phrase: SpotlightSpokenPhrase) => void;
  maxPhrases?: number;
  minChars?: number;
}) {
  const maxPhrases = Math.max(1, options?.maxPhrases ?? SPOKEN_SENTENCE_MAX_COUNT);
  const minChars = options?.minChars ?? SPOKEN_SENTENCE_MIN_CHARS;
  let buffer = "";
  let held = "";
  let index = 0;
  let emitted = 0;
  let generation = 0;

  const emit = (text: string) => {
    if (!text || emitted >= maxPhrases) return;
    const phrase = { index, text, generation };
    index += 1;
    emitted += 1;
    options?.onPhrase?.(phrase);
  };

  const flushHeld = (force: boolean) => {
    if (!held || emitted >= maxPhrases) return;
    if (!force && held.length < minChars) return;
    for (const text of packSpokenSentences(held, {
      minChars,
      maxSentences: maxPhrases - emitted,
    })) {
      emit(text);
    }
    held = "";
  };

  return {
    get emitted() {
      return emitted;
    },
    get generation() {
      return generation;
    },
    reset() {
      generation += 1;
      buffer = "";
      held = "";
      index = 0;
      emitted = 0;
    },
    push(delta: string) {
      if (!delta || emitted >= maxPhrases) return;
      buffer += delta;
      const taken = takeSpokenPhrases(buffer);
      buffer = taken.rest;
      if (taken.phrases.length === 0) return;
      held += taken.phrases.join("");
      flushHeld(false);
    },
    finish(fullAnswer?: string) {
      const tail = buffer.replace(/\s+/gu, " ").trim();
      buffer = "";
      if (tail) held += normalizePhrase(tail);
      flushHeld(true);
      if (emitted === 0 && fullAnswer?.trim()) {
        for (const text of splitSpokenPhrases(fullAnswer, maxPhrases)) {
          emit(text);
        }
      }
    },
  };
}

const PHASE_TRANSITIONS: Record<SpotlightVoicePhase, SpotlightVoicePhase[]> = {
  idle: ["listening", "thinking", "error"],
  listening: ["thinking", "interrupted", "idle", "error", "speaking"],
  thinking: ["tool-running", "speaking", "interrupted", "error", "listening", "idle"],
  "tool-running": ["thinking", "speaking", "interrupted", "error", "listening"],
  speaking: ["listening", "interrupted", "idle", "error", "thinking"],
  interrupted: ["listening", "idle", "error", "thinking"],
  error: ["idle", "listening"],
};

export class VoiceTurnController {
  phase: SpotlightVoicePhase = "idle";
  private readonly abortHandlers = new Set<
    (reason: SpotlightVoiceAbortReason) => void | Promise<void>
  >();
  private aborting = false;

  onAbort(
    handler: (reason: SpotlightVoiceAbortReason) => void | Promise<void>,
  ): () => void {
    this.abortHandlers.add(handler);
    return () => {
      this.abortHandlers.delete(handler);
    };
  }

  setPhase(next: SpotlightVoicePhase): void {
    if (next === this.phase) return;
    const allowed = PHASE_TRANSITIONS[this.phase];
    if (!allowed.includes(next) && next !== "interrupted" && next !== "error") {
      return;
    }
    this.phase = next;
  }

  async abort(reason: SpotlightVoiceAbortReason): Promise<void> {
    if (this.aborting) return;
    if (this.phase === "interrupted" || this.phase === "error") return;
    this.aborting = true;
    this.phase = reason === "error" ? "error" : "interrupted";
    try {
      await Promise.allSettled(
        [...this.abortHandlers].map((handler) =>
          Promise.resolve().then(() => handler(reason)),
        ),
      );
    } finally {
      this.aborting = false;
    }
  }

  resetTo(phase: "idle" | "listening"): void {
    this.phase = phase;
  }
}
