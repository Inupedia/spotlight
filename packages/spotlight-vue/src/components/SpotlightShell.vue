<template>
  <SpotlightRoot
    :deck-kicker="deckKicker"
    :voice-hold-active="voiceHoldActive"
    :speech-pending="speechPending"
    :voice-key-label="VOICE_INPUT_KEY_LABEL"
    :show-thinking="showSpotlightThinkingBar"
    :thinking-centered="thinkingBarCentered"
    :on-escape="onSpotlightEscape"
    :on-keydown="onSpotlightKeydown"
    :on-keyup="onSpotlightKeyup"
    @visible-change="onPanelVisibleChange"
  />
  <Live2dPanel
    v-if="avatarEnabled && live2dVisible"
    :voice-disabled="store.loading || speechPending || voiceStarting"
    :voice-error="store.error"
    @voice-start="startLive2dVoiceRecording"
    @voice-stop="stopLive2dVoiceRecording"
    @close="live2dOverlay.hide"
  />
  <button
    v-else-if="avatarEnabled"
    type="button"
    class="spotlight-avatar-reopen"
    aria-label="再次打开数字人小滴"
    title="再次打开小滴（Ctrl/Command + L）"
    @click="showLive2dAvatar"
  >
    <span class="spotlight-avatar-reopen__drop" aria-hidden="true" />
    <span class="spotlight-avatar-reopen__label">小滴</span>
  </button>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { waitForAudioNaturalEnd } from "../avatar/speech/live2dTtsPlayback.js";
import type { WavEnvelope } from "../avatar/spine/live2dApp.js";
import {
  hasSpotlightSpeechConfig,
  SpotlightSpeechService,
} from "../avatar/speech/spotlightSpeech.js";
import { storeToRefs } from "pinia";
import { useSpotlightStore } from "../store/spotlightStore.js";
import { useSpotlightAvatarConfig } from "../avatar/config.js";
import SpotlightRoot from "./SpotlightRoot.vue";
import Live2dPanel from "./Live2dPanel.vue";
import { useLive2dOverlayStore } from "../store/live2dOverlayStore.js";
import { useLive2dSpeechStore } from "../store/live2dSpeechStore.js";
import { useLive2dVoiceChannelStore } from "../store/live2dVoiceChannelStore.js";
import { devWarn } from "../utils/devConsole.js";

const props = withDefaults(
  defineProps<{ avatarEnabled?: boolean }>(),
  { avatarEnabled: false },
);

const avatarConfig = useSpotlightAvatarConfig();
const deckKicker = computed(
  () => avatarConfig.deckKicker?.trim() || "SPOTLIGHT",
);
const greetingText = computed(
  () => avatarConfig.greetingText?.trim() || "您好，我是 Spotlight 助手",
);

const store = useSpotlightStore();
const live2dOverlay = useLive2dOverlayStore();
const { visible: live2dVisible } = storeToRefs(live2dOverlay);
const live2dSpeech = useLive2dSpeechStore();
const live2dVoiceChannel = useLive2dVoiceChannelStore();
const speechService = new SpotlightSpeechService();

const VOICE_INPUT_KEY_CODE = "Backquote";
const VOICE_INPUT_KEY_LABEL = "`";
const voiceHoldTimer = ref<number | null>(null);
const voiceHoldActive = ref(false);
const speechPending = ref(false);
const voiceStarting = ref(false);
const speechAbortController = ref<AbortController | null>(null);
const ttsAudio = ref<HTMLAudioElement | null>(null);
const ttsAudioUrl = ref<string | null>(null);
const ttsAbortController = ref<AbortController | null>(null);
const activeSpeechToken = ref(0);
const live2dHoldThinkingUntilSpeech = ref(false);
const live2dBriefingKeepLastMs = computed(() =>
  Math.max(
    0,
    avatarConfig.briefingKeepLastMs ??
      (Number(import.meta.env.VITE_LIVE2D_BRIEFING_KEEP_LAST_MS ?? 0) || 0),
  ),
);
let live2dGreetingAbort: AbortController | null = null;
const sttFromLive2dVoiceChannel = ref(false);
let voicePlaybackTail: Promise<void> = Promise.resolve();
let queuedVoiceSentences = 0;

const showSpotlightThinkingBar = computed(() => {
  if (!store.showThinkingBar) return false;
  if (!props.avatarEnabled || !live2dVisible.value) return true;
  if (
    store.pipelinePhase === "running" ||
    live2dHoldThinkingUntilSpeech.value
  ) {
    return true;
  }
  return store.pipelinePhase === "done";
});

const thinkingBarCentered = computed(() => {
  const isKnowledgeQa =
    store.agentSteps.length === 1 && store.agentSteps[0]?.label === "回答";
  return (
    store.pipelinePhase === "running" ||
    isKnowledgeQa ||
    live2dHoldThinkingUntilSpeech.value
  );
});

function dismissLive2dThinkingForSpeech(): void {
  live2dHoldThinkingUntilSpeech.value = false;
  if (live2dVisible.value) {
    store.showThinkingBar = false;
  }
}

function clearVoiceHoldTimer() {
  if (voiceHoldTimer.value != null) {
    window.clearTimeout(voiceHoldTimer.value);
    voiceHoldTimer.value = null;
  }
}

function cancelSpeechSession() {
  clearVoiceHoldTimer();
  if (speechAbortController.value) {
    speechAbortController.value.abort();
    speechAbortController.value = null;
  }
  speechPending.value = false;
  voiceStarting.value = false;
  voiceHoldActive.value = false;
  sttFromLive2dVoiceChannel.value = false;
  live2dVoiceChannel.reset();
  speechService.cancel();
}

function stopTtsPlayback() {
  if (live2dGreetingAbort) {
    live2dGreetingAbort.abort();
    live2dGreetingAbort = null;
  }
  if (ttsAbortController.value) {
    ttsAbortController.value.abort();
    ttsAbortController.value = null;
  }
  releaseCurrentTtsAudio();
  live2dSpeech.reset();
  void import("../avatar/spine/live2dApp.js").then((live2d) =>
    live2d.stopLive2dLipSync(),
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function playLive2dGreetingWhenOpened(): Promise<void> {
  if (!live2dVisible.value || store.pipelinePhase === "running") return;

  stopTtsPlayback();
  activeSpeechToken.value += 1;
  const speechToken = activeSpeechToken.value;
  const controller = new AbortController();
  live2dGreetingAbort = controller;

  if (!hasSpotlightSpeechConfig()) {
    live2dGreetingAbort = null;
    await nextTick();
    const live2d = await import("../avatar/spine/live2dApp.js");
    live2d.playLive2dHello();
    live2dSpeech.start(greetingText.value, { instant: true });
    live2dSpeech.reset();
    return;
  }

  const synthesizePromise = speechService.synthesize(
    greetingText.value,
    controller.signal,
  );

  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  if (!isLive2dTtsSessionActive(controller, speechToken)) return;

  try {
    const { blob } = await synthesizePromise;
    if (!isLive2dTtsSessionActive(controller, speechToken)) return;
    await playLive2dTtsBlob(
      greetingText.value,
      blob,
      controller,
      speechToken,
      { instantText: true, playHelloWithSpeech: true },
    );
  } catch (err) {
    if (controller.signal.aborted) return;
    const message =
      err instanceof Error ? err.message : "数字人招呼语音失败，请稍后重试。";
    devWarn("[live2d-greeting]", message);
    if (isLive2dTtsSessionActive(controller, speechToken)) {
      const live2d = await import("../avatar/spine/live2dApp.js");
      live2d.playLive2dHello();
      live2dSpeech.start(greetingText.value, { instant: true });
      live2dSpeech.reset();
    }
  } finally {
    if (live2dGreetingAbort === controller) {
      live2dGreetingAbort = null;
    }
  }
}

function releaseCurrentTtsAudio() {
  if (ttsAudio.value) {
    ttsAudio.value.pause();
    ttsAudio.value.src = "";
    ttsAudio.value = null;
  }
  if (ttsAudioUrl.value) {
    URL.revokeObjectURL(ttsAudioUrl.value);
    ttsAudioUrl.value = null;
  }
}

function beginVoiceResponseStream(): void {
  stopTtsPlayback();
  activeSpeechToken.value += 1;
  const controller = new AbortController();
  ttsAbortController.value = controller;
  voicePlaybackTail = Promise.resolve();
  queuedVoiceSentences = 0;
  live2dHoldThinkingUntilSpeech.value = true;
}

function enqueueVoiceSentence(sentence: { index: number; text: string }): void {
  const controller = ttsAbortController.value;
  if (!controller || controller.signal.aborted || !sentence.text.trim()) return;
  const speechToken = activeSpeechToken.value;
  const synthesis = speechService
    .synthesize(sentence.text, controller.signal)
    .then(
      (result) => ({ blob: result.blob, error: null }),
      (error: unknown) => ({ blob: null, error }),
    );
  queuedVoiceSentences += 1;
  voicePlaybackTail = voicePlaybackTail
    .then(async () => {
      const prefetched = await synthesis;
      if (prefetched.error) throw prefetched.error;
      if (!prefetched.blob) return;
      if (!isLive2dTtsSessionActive(controller, speechToken)) return;
      if (sentence.index === 0) {
        dismissLive2dThinkingForSpeech();
      }
      await playLive2dTtsBlob(
        sentence.text,
        prefetched.blob,
        controller,
        speechToken,
        {
          instantText: true,
          hasFollowingClip: true,
        },
      );
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      store.error =
        err instanceof Error ? err.message : "数字人语音播放失败，请稍后重试。";
    });
}

async function finishVoiceResponseStream(): Promise<void> {
  const controller = ttsAbortController.value;
  if (!controller) return;
  const speechToken = activeSpeechToken.value;
  await voicePlaybackTail;
  live2dHoldThinkingUntilSpeech.value = false;
  releaseCurrentTtsAudio();
  const live2d = await import("../avatar/spine/live2dApp.js");
  live2d.stopLive2dLipSync();
  if (isLive2dTtsSessionActive(controller, speechToken)) {
    if (live2dBriefingKeepLastMs.value > 0 && queuedVoiceSentences > 0) {
      try {
        await wait(live2dBriefingKeepLastMs.value, controller.signal);
      } catch {
        // ignore abort
      }
    }
    if (isLive2dTtsSessionActive(controller, speechToken)) {
      live2dSpeech.reset();
    }
  }
  if (ttsAbortController.value === controller) {
    ttsAbortController.value = null;
  }
}

function isLive2dTtsSessionActive(
  controller: AbortController,
  speechToken: number,
): boolean {
  return !controller.signal.aborted && activeSpeechToken.value === speechToken;
}

async function playLive2dTtsBlob(
  text: string,
  blob: Blob,
  controller: AbortController,
  speechToken: number,
  options?: {
    instantText?: boolean;
    hasFollowingClip?: boolean;
    lipSyncEnvelope?: WavEnvelope;
    playHelloWithSpeech?: boolean;
  },
): Promise<void> {
  if (!isLive2dTtsSessionActive(controller, speechToken)) return;

  const hasFollowingClip = options?.hasFollowingClip ?? false;
  releaseCurrentTtsAudio();
  const audioUrl = URL.createObjectURL(blob);
  ttsAudioUrl.value = audioUrl;
  const audio = new Audio(audioUrl);
  audio.volume = 1;
  ttsAudio.value = audio;

  const live2d = await import("../avatar/spine/live2dApp.js");
  const { buildWavEnvelopeFromBlob } = await import("../avatar/spine/spineLipSync.js");
  const envelope =
    options?.lipSyncEnvelope ?? (await buildWavEnvelopeFromBlob(blob));

  if (!isLive2dTtsSessionActive(controller, speechToken)) return;

  if (options?.playHelloWithSpeech) {
    live2d.playLive2dHello();
  }

  live2d.bindLive2dLipSyncToAudio(audio, envelope);
  live2dSpeech.start(text, { instant: options?.instantText ?? true });
  try {
    await audio.play();
  } catch (err) {
    live2d.stopLive2dLipSync();
    releaseCurrentTtsAudio();
    throw err;
  }

  await waitForAudioNaturalEnd(audio, controller.signal);

  live2d.stopLive2dLipSync();
  releaseCurrentTtsAudio();
  if (!isLive2dTtsSessionActive(controller, speechToken)) return;

  if (hasFollowingClip) {
    live2dSpeech.finish();
    return;
  }

  live2dSpeech.reset();
}

function canLive2dHiddenVoiceStt(): boolean {
  if (!props.avatarEnabled) return false;
  return (
    live2dVisible.value &&
    !store.visible &&
    !store.loading &&
    !voiceStarting.value &&
    !speechPending.value
  );
}

async function stopSpeechAndFillPrompt() {
  if (speechPending.value) return;
  const submitAfterTranscribe = sttFromLive2dVoiceChannel.value;
  voiceHoldActive.value = false;
  if (submitAfterTranscribe) {
    live2dVoiceChannel.setTranscribing(true);
  }
  speechPending.value = true;
  const controller = new AbortController();
  speechAbortController.value = controller;
  try {
    const { text } = await speechService.stopAndTranscribe(controller.signal);
    const trimmed = text.trim();
    if (submitAfterTranscribe) {
      sttFromLive2dVoiceChannel.value = false;
      live2dVoiceChannel.setTranscribing(false);
      if (!trimmed) return;
      store.prompt = trimmed;
      beginVoiceResponseStream();
      try {
        await store.submit({
          interactionMode: "voice",
          onVoiceSentence: enqueueVoiceSentence,
        });
      } finally {
        await finishVoiceResponseStream();
      }
      return;
    }
    const current = store.prompt.trim();
    store.prompt = current ? `${current} ${text}` : text;
  } catch (err) {
    if (controller.signal.aborted) return;
    const message =
      err instanceof Error ? err.message : "语音识别失败，请重试。";
    store.error = message;
  } finally {
    speechAbortController.value = null;
    speechPending.value = false;
    voiceHoldActive.value = false;
    sttFromLive2dVoiceChannel.value = false;
    live2dVoiceChannel.reset();
  }
}

function onVoiceHoldKeydown(event: KeyboardEvent) {
  if (event.repeat) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

  const hiddenThinkingStt = canLive2dHiddenVoiceStt();
  if (!store.visible && !hiddenThinkingStt) return;
  if (store.visible && store.loading) return;

  event.preventDefault();
  if (voiceHoldTimer.value != null || voiceHoldActive.value) return;
  voiceHoldTimer.value = window.setTimeout(async () => {
    voiceHoldTimer.value = null;
    const useHiddenPath = canLive2dHiddenVoiceStt();
    if (!store.visible && !useHiddenPath) return;
    if (store.visible && store.loading) return;
    try {
      await speechService.startRecording();
      voiceHoldActive.value = true;
      sttFromLive2dVoiceChannel.value = useHiddenPath;
      if (useHiddenPath) {
        live2dVoiceChannel.setRecording(true);
      } else {
        live2dVoiceChannel.reset();
      }
      store.error = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "无法启动语音录制。";
      store.error = message;
      voiceHoldActive.value = false;
      sttFromLive2dVoiceChannel.value = false;
      live2dVoiceChannel.reset();
    }
  }, 450);
}

async function startLive2dVoiceRecording(): Promise<void> {
  if (!canLive2dHiddenVoiceStt() || voiceStarting.value) return;
  voiceStarting.value = true;
  try {
    stopTtsPlayback();
    await speechService.startRecording();
    if (!live2dVisible.value) {
      speechService.cancel();
      return;
    }
    voiceHoldActive.value = true;
    sttFromLive2dVoiceChannel.value = true;
    live2dVoiceChannel.setRecording(true);
    store.error = "";
  } catch (err) {
    const message = err instanceof Error ? err.message : "无法启动语音录制。";
    store.error = message;
    voiceHoldActive.value = false;
    sttFromLive2dVoiceChannel.value = false;
    live2dVoiceChannel.reset();
  } finally {
    voiceStarting.value = false;
  }
}

function stopLive2dVoiceRecording(): void {
  if (!voiceHoldActive.value) return;
  void stopSpeechAndFillPrompt();
}

function onSpotlightKeyup(event: KeyboardEvent) {
  if (event.code !== VOICE_INPUT_KEY_CODE) return;
  if (!store.visible && !voiceHoldActive.value) return;
  event.preventDefault();
  const hadLongPress = voiceHoldActive.value;
  clearVoiceHoldTimer();
  if (hadLongPress) {
    void stopSpeechAndFillPrompt();
  }
}

function onSpotlightKeydown(event: KeyboardEvent) {
  if (event.code === VOICE_INPUT_KEY_CODE) {
    onVoiceHoldKeydown(event);
    return;
  }

  const key = event.key.toLowerCase();
  const isMeta = event.metaKey || event.ctrlKey;
  if (!props.avatarEnabled) return;
  if (isMeta && key === "l") {
    event.preventDefault();
    live2dOverlay.toggle();
  }
}

function showLive2dAvatar(): void {
  live2dOverlay.show();
}

function onSpotlightEscape() {
  live2dHoldThinkingUntilSpeech.value = false;
  activeSpeechToken.value += 1;
  stopTtsPlayback();
  live2dSpeech.reset();
  if (store.showThinkingBar) {
    store.closeThinking();
  } else if (store.visible) {
    store.close();
  }
}

function onPanelVisibleChange(visible: boolean) {
  if (!visible) {
    cancelSpeechSession();
    if (live2dVisible.value) {
      store.prepareLive2dVoiceChannel();
    }
    return;
  }
}

watch(live2dVisible, (on) => {
  if (!props.avatarEnabled) return;
  if (!on) {
    live2dHoldThinkingUntilSpeech.value = false;
    cancelSpeechSession();
    stopTtsPlayback();
    live2dSpeech.reset();
    live2dVoiceChannel.reset();
    return;
  }
  if (!store.visible) {
    store.prepareLive2dVoiceChannel();
  }
  void playLive2dGreetingWhenOpened();
});

onMounted(() => {
  if (props.avatarEnabled && avatarConfig.initiallyVisible) {
    live2dOverlay.show();
  }
});

onUnmounted(() => {
  cancelSpeechSession();
  stopTtsPlayback();
  live2dSpeech.reset();
  live2dVoiceChannel.reset();
});
</script>

<style scoped>
.spotlight-avatar-reopen {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483001;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 13px 8px 10px;
  border: 1px solid rgba(14, 165, 233, 0.32);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  color: #0f766e;
  font: 600 13px/1 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 12px 30px rgba(15, 118, 110, 0.2);
  backdrop-filter: blur(12px);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.spotlight-avatar-reopen:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 36px rgba(15, 118, 110, 0.26);
}

.spotlight-avatar-reopen__drop {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 55% 45% 60% 40%;
  background: linear-gradient(145deg, #38bdf8, #14b8a6);
  transform: rotate(45deg);
  box-shadow: inset 3px 3px 5px rgba(255, 255, 255, 0.42);
}

.spotlight-avatar-reopen__drop::after {
  content: "";
  position: absolute;
  top: 4px;
  left: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.86);
}

.spotlight-avatar-reopen__label {
  letter-spacing: 0.04em;
}

@media (max-width: 720px) {
  .spotlight-avatar-reopen {
    right: 14px;
    bottom: 14px;
  }
}
</style>
