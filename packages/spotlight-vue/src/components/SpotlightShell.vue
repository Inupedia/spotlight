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
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  buildFastLive2dBriefing,
  summarizeLive2dBriefing,
  type Live2dBriefingSentence,
} from "../avatar/speech/live2dBriefingSummarizer.js";
import { isGenericHostExecutionReply } from "../avatar/speech/live2dAnswerSpeechPolicy.js";
import { LIVE2D_ANSWER_STEP_ID } from "../avatar/speech/live2dStreamSpeech.js";
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
const lastSpokenPipelineRunId = ref(0);
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

function getAnswerStepSpeechText(): string {
  const step =
    store.agentSteps.find((item) => item.id === LIVE2D_ANSWER_STEP_ID) ??
    store.agentSteps.find((item) => item.label === "回答") ??
    store.agentSteps.find((item) => item.label === "执行工具与回答") ??
    store.agentSteps.find((item) => item.label === "知识问答");
  return step?.content ?? "";
}

async function speakAnswerStepWithLive2d(): Promise<void> {
  const text = getAnswerStepSpeechText().trim();
  if (!text || !live2dVisible.value || isGenericHostExecutionReply(text)) {
    live2dHoldThinkingUntilSpeech.value = false;
    return;
  }

  stopTtsPlayback();
  const speechToken = activeSpeechToken.value;
  const controller = new AbortController();
  ttsAbortController.value = controller;

  try {
    const fastPlan = buildFastLive2dBriefing(text);
    let activeSentences = fastPlan.sentences;
    if (!activeSentences.length) {
      live2dHoldThinkingUntilSpeech.value = false;
      return;
    }

    let refinedPlanSentences: Live2dBriefingSentence[] | null = null;
    let refinedApplied = false;
    const refinedTask = summarizeLive2dBriefing(text, controller.signal)
      .then((plan) => {
        if (plan.sentences.length > 0) {
          refinedPlanSentences = plan.sentences;
        }
      })
      .catch(() => {});

    let prefetchIndex = -1;
    let prefetchTask: Promise<Blob> | null = null;
    const schedulePrefetch = (index: number) => {
      if (index < 0 || index >= activeSentences.length) return;
      if (prefetchIndex === index && prefetchTask) return;
      prefetchIndex = index;
      prefetchTask = speechService
        .synthesize(activeSentences[index]!.text, controller.signal)
        .then((result) => result.blob);
    };

    let spokenIndex = 0;
    while (spokenIndex < activeSentences.length) {
      if (!isLive2dTtsSessionActive(controller, speechToken)) return;

      if (!refinedApplied && refinedPlanSentences) {
        activeSentences = refinedPlanSentences;
        refinedApplied = true;
        prefetchIndex = -1;
        prefetchTask = null;
        if (spokenIndex >= activeSentences.length) break;
      }

      const sentence = activeSentences[spokenIndex]!;
      schedulePrefetch(spokenIndex);
      const blob =
        prefetchIndex === spokenIndex && prefetchTask
          ? await prefetchTask
          : (await speechService.synthesize(sentence.text, controller.signal))
              .blob;
      if (!isLive2dTtsSessionActive(controller, speechToken)) return;
      schedulePrefetch(spokenIndex + 1);

      if (spokenIndex === 0) {
        dismissLive2dThinkingForSpeech();
      }

      await playLive2dTtsBlob(sentence.text, blob, controller, speechToken, {
        instantText: true,
        hasFollowingClip: spokenIndex + 1 < activeSentences.length,
      });

      const pauseMs = sentence.pauseMs ?? 0;
      if (pauseMs > 0 && isLive2dTtsSessionActive(controller, speechToken)) {
        try {
          await wait(pauseMs, controller.signal);
        } catch {
          return;
        }
      }

      spokenIndex += 1;
    }
    await refinedTask;
  } catch (err) {
    if (controller.signal.aborted) return;
    stopTtsPlayback();
    const message =
      err instanceof Error ? err.message : "数字人语音播放失败，请稍后重试。";
    store.error = message;
  } finally {
    live2dHoldThinkingUntilSpeech.value = false;
    releaseCurrentTtsAudio();
    const live2d = await import("../avatar/spine/live2dApp.js");
    live2d.stopLive2dLipSync();
    if (isLive2dTtsSessionActive(controller, speechToken)) {
      if (live2dBriefingKeepLastMs.value > 0) {
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
      if (!trimmed) return;
      store.prompt = trimmed;
      await store.submit();
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

watch(
  () =>
    [store.pipelinePhase, store.pipelineRunId, live2dVisible.value] as const,
  ([phase, runId, live2dOn]) => {
    if (!props.avatarEnabled) return;
    if (phase === "running") {
      live2dHoldThinkingUntilSpeech.value = false;
      stopTtsPlayback();
      return;
    }
    if (phase !== "done") {
      if (phase === "error" || phase === "cancelled") {
        live2dHoldThinkingUntilSpeech.value = false;
        stopTtsPlayback();
      }
      return;
    }
    if (!live2dOn) return;
    if (runId <= lastSpokenPipelineRunId.value) return;
    lastSpokenPipelineRunId.value = runId;
    void nextTick(() => {
      const text = getAnswerStepSpeechText().trim();
      if (
        !text ||
        isGenericHostExecutionReply(text) ||
        !hasSpotlightSpeechConfig()
      ) {
        live2dHoldThinkingUntilSpeech.value = false;
        return;
      }
      live2dHoldThinkingUntilSpeech.value = true;
      activeSpeechToken.value += 1;
      void speakAnswerStepWithLive2d();
    });
  },
);

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
