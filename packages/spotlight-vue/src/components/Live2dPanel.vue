<template>
  <div class="live2d-panel-shell">
    <div id="live2d-container" class="live2d-panel" aria-label="Live2D" />
    <button
      type="button"
      class="live2d-close"
      aria-label="关闭数字人"
      title="关闭数字人（Ctrl/Command + L 可再次打开）"
      @click="emit('close')"
    >
      ×
    </button>
    <div class="live2d-voice-controls">
      <button
        type="button"
        class="live2d-voice-button"
        :class="{
          'is-recording': voiceChannel.recording,
          'is-transcribing': voiceChannel.transcribing,
        }"
        :disabled="voiceDisabled || voiceChannel.transcribing"
        :aria-label="voiceButtonLabel"
        @click="onVoiceClick"
      >
        <span class="live2d-mic-icon" aria-hidden="true" />
      </button>
      <span class="live2d-voice-label">{{ voiceButtonLabel }}</span>
      <span v-if="voiceError" class="live2d-voice-error" role="alert">
        {{ voiceError }}
      </span>
    </div>
    <Transition name="speech-bubble">
      <div
        v-if="speechVisible"
        class="live2d-speech-bubble"
        :class="{ 'is-speaking': speaking }"
      >
        <div class="live2d-speech-head">
          <span class="live2d-speech-dot" />
          <span>{{ avatarConfig.bubbleTitle ?? "数字人" }}</span>
        </div>
        <p class="live2d-speech-text">{{ animatedText }}</p>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { startLive2dApp, stopLive2dApp } from "../avatar/spine/live2dApp.js";
import { configureSpineAvatar } from "../avatar/spine/spineAvatar.js";
import { useSpotlightAvatarConfig } from "../avatar/config.js";
import { useLive2dSpeechStore } from "../store/live2dSpeechStore.js";
import { useLive2dVoiceChannelStore } from "../store/live2dVoiceChannelStore.js";

const props = withDefaults(
  defineProps<{ voiceDisabled?: boolean; voiceError?: string }>(),
  { voiceDisabled: false, voiceError: "" },
);
const emit = defineEmits<{
  voiceStart: [];
  voiceStop: [];
  close: [];
}>();

const speechStore = useLive2dSpeechStore();
const voiceChannel = useLive2dVoiceChannelStore();
const avatarConfig = useSpotlightAvatarConfig();
const { message, speaking, revealInstant } = storeToRefs(speechStore);
const animatedText = ref("");
let typingTimer: number | null = null;

const speechVisible = computed(() => {
  return speaking.value || message.value.trim().length > 0;
});
const voiceButtonLabel = computed(() => {
  if (voiceChannel.recording) return "点击发送";
  if (voiceChannel.transcribing) return "正在识别…";
  if (props.voiceDisabled) return "Spotlight 忙碌中";
  return "点击说话";
});

function onVoiceClick(event: MouseEvent): void {
  if (props.voiceDisabled || voiceChannel.transcribing) return;
  event.preventDefault();
  if (voiceChannel.recording) emit("voiceStop");
  else emit("voiceStart");
}

function clearTypingTimer() {
  if (typingTimer != null) {
    window.clearInterval(typingTimer);
    typingTimer = null;
  }
}

watch(
  () => [message.value, revealInstant.value] as const,
  ([text, instant]) => {
    clearTypingTimer();
    const normalized = text.trim();
    if (!normalized) {
      animatedText.value = "";
      return;
    }

    if (instant) {
      animatedText.value = normalized;
      return;
    }

    animatedText.value = "";
    let index = 0;
    typingTimer = window.setInterval(() => {
      index += 1;
      animatedText.value = normalized.slice(0, index);
      if (index >= normalized.length) {
        clearTypingTimer();
      }
    }, 24);
  },
  { immediate: true },
);

onMounted(async () => {
  configureSpineAvatar(avatarConfig);
  await startLive2dApp();
});

onUnmounted(() => {
  clearTypingTimer();
  speechStore.reset();
  stopLive2dApp();
});
</script>

<style scoped>
.live2d-panel-shell {
  position: fixed;
  right: 220px;
  bottom: 16px;
  z-index: 5000;
  width: min(420px, 42vw);
  height: min(560px, 52vh);
  pointer-events: none;
}

.live2d-panel {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  touch-action: none;
  background: transparent;
}

.live2d-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #64748b;
  font:
    22px/1 system-ui,
    sans-serif;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.1);
}

.live2d-voice-controls {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transform: translateX(-50%);
  pointer-events: auto;
  user-select: none;
}

.live2d-voice-button {
  position: relative;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border: 1px solid rgba(13, 148, 136, 0.34);
  border-radius: 999px;
  background: linear-gradient(145deg, #ffffff, #ecfeff);
  color: #0f766e;
  cursor: pointer;
  touch-action: none;
  box-shadow:
    0 12px 28px rgba(13, 148, 136, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease;
}

.live2d-voice-button:not(:disabled):hover {
  transform: translateY(-2px);
}

.live2d-voice-button.is-recording {
  background: linear-gradient(145deg, #fff1f2, #ffe4e6);
  color: #e11d48;
  box-shadow:
    0 0 0 8px rgba(244, 63, 94, 0.12),
    0 14px 30px rgba(225, 29, 72, 0.24);
  animation: voice-pulse 1.1s ease-in-out infinite;
}

.live2d-voice-button.is-transcribing {
  cursor: wait;
  animation: voice-spin 1.3s linear infinite;
}

.live2d-voice-button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.live2d-mic-icon {
  width: 14px;
  height: 22px;
  border: 2px solid currentcolor;
  border-radius: 8px;
}

.live2d-mic-icon::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 25px;
  width: 22px;
  height: 12px;
  border: 2px solid currentcolor;
  border-top: 0;
  border-radius: 0 0 12px 12px;
  transform: translateX(-50%);
}

.live2d-mic-icon::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 37px;
  width: 2px;
  height: 7px;
  background: currentcolor;
  transform: translateX(-50%);
}

.live2d-voice-label {
  padding: 4px 9px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #475569;
  font-size: 12px;
  line-height: 1.2;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
}

.live2d-voice-error {
  width: min(280px, 64vw);
  padding: 7px 10px;
  border: 1px solid rgba(244, 63, 94, 0.32);
  border-radius: 10px;
  background: rgba(255, 241, 242, 0.96);
  color: #be123c;
  font-size: 12px;
  line-height: 1.45;
  max-height: 72px;
  overflow: auto;
  text-align: center;
  box-shadow: 0 8px 18px rgba(159, 18, 57, 0.12);
}

.live2d-speech-bubble {
  position: absolute;
  right: calc(100% - 36px);
  bottom: 44%;
  width: min(360px, 40vw);
  max-height: 32vh;
  overflow: hidden auto;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.96),
    rgba(240, 253, 250, 0.94)
  );
  box-shadow:
    0 18px 36px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  color: #0f172a;
  padding: 10px 12px;
  pointer-events: auto;
}

.live2d-speech-bubble.is-speaking {
  border-color: rgba(20, 184, 166, 0.45);
  box-shadow:
    0 20px 40px rgba(20, 184, 166, 0.14),
    0 0 0 1px rgba(14, 165, 233, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.live2d-speech-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #0d9488;
  font-size: 12px;
  line-height: 1;
}

.live2d-speech-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentcolor;
  box-shadow: 0 0 12px currentcolor;
}

.live2d-speech-bubble.is-speaking .live2d-speech-dot {
  animation: speech-pulse 1.1s ease-in-out infinite;
}

.live2d-speech-text {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
}

.speech-bubble-enter-active,
.speech-bubble-leave-active {
  transition: all 0.28s ease;
}

.speech-bubble-enter-from,
.speech-bubble-leave-to {
  opacity: 0;
  transform: translateX(10px) scale(0.98);
}

@keyframes speech-pulse {
  0% {
    opacity: 0.65;
    transform: scale(0.95);
  }
  50% {
    opacity: 1;
    transform: scale(1.12);
  }
  100% {
    opacity: 0.65;
    transform: scale(0.95);
  }
}

@keyframes voice-pulse {
  50% {
    transform: scale(1.04);
  }
}

@keyframes voice-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .live2d-panel-shell {
    right: 0;
    bottom: 8px;
    width: min(360px, 96vw);
    height: min(500px, 62vh);
  }

  .live2d-speech-bubble {
    right: 16px;
    bottom: 70%;
    width: min(320px, 88vw);
  }
}
</style>
