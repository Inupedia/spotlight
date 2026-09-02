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
        <span class="live2d-voice-ring" aria-hidden="true" />
        <span class="live2d-mic-icon" aria-hidden="true" />
      </button>
      <span class="live2d-voice-label">{{ voiceButtonLabel }}</span>
      <button
        v-if="phonePairAvailable"
        type="button"
        class="live2d-phone-button"
        :class="{ 'is-connected': phoneConnected }"
        aria-label="用手机说话"
        @click="emit('phonePair')"
      >
        用手机说话
      </button>
    </div>
    <Teleport to="body">
      <div
        v-if="phonePairOpen"
        class="live2d-phone-overlay"
        @click.self="emit('phonePairClose')"
      >
        <div
          class="live2d-phone-panel"
          role="dialog"
          aria-modal="true"
          aria-label="手机语音遥控器"
        >
          <header class="live2d-phone-header">
            <div class="live2d-phone-title-stack">
              <span class="live2d-phone-kicker">Spotlight</span>
              <span class="live2d-phone-title">手机遥控器</span>
            </div>
            <button
              type="button"
              class="live2d-phone-close"
              aria-label="关闭手机二维码"
              @click="emit('phonePairClose')"
            >
              ×
            </button>
          </header>
          <p class="live2d-phone-hint">
            用手机扫码打开遥控器，即可对着手机说话控制大屏。微信扫完后请选「用浏览器打开」。
          </p>
          <div class="live2d-phone-actions">
            <button
              type="button"
              class="live2d-phone-primary"
              :disabled="!phonePairUrl"
              @click="openLocalPreview"
            >
              本机打开遥控器
            </button>
            <button
              type="button"
              class="live2d-phone-secondary"
              :disabled="!phonePairUrl"
              @click="copyPairUrl"
            >
              {{ copied ? "已复制" : "复制链接" }}
            </button>
          </div>
          <div v-if="phonePairQr" class="live2d-phone-qr" v-html="phonePairQr" />
          <p class="live2d-phone-status">
            {{
              phoneConnected
                ? "手机已连接，对着遥控器说话即可"
                : "等待遥控器连接"
            }}
          </p>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="noticeText"
        class="live2d-notice-overlay"
        @click.self="dismissNotice"
      >
        <div
          class="live2d-notice"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="live2d-notice-title"
        >
          <header class="live2d-notice-header">
            <div class="live2d-phone-title-stack">
              <span class="live2d-phone-kicker">Spotlight</span>
              <span id="live2d-notice-title" class="live2d-phone-title">提示</span>
            </div>
          </header>
          <p class="live2d-notice-body">{{ noticeText }}</p>
          <button
            type="button"
            class="live2d-notice-ok"
            autofocus
            @click="dismissNotice"
          >
            知道了
          </button>
        </div>
      </div>
    </Teleport>
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
  defineProps<{
    voiceDisabled?: boolean;
    voiceError?: string;
    phonePairAvailable?: boolean;
    phonePairOpen?: boolean;
    phonePairQr?: string;
    phonePairUrl?: string;
    phonePairError?: string;
    phoneConnected?: boolean;
  }>(),
  {
    voiceDisabled: false,
    voiceError: "",
    phonePairAvailable: false,
    phonePairOpen: false,
    phonePairQr: "",
    phonePairUrl: "",
    phonePairError: "",
    phoneConnected: false,
  },
);
const emit = defineEmits<{
  voiceStart: [];
  voiceStop: [];
  close: [];
  phonePair: [];
  phonePairClose: [];
  dismissError: [];
  dismissPairError: [];
}>();

const speechStore = useLive2dSpeechStore();
const voiceChannel = useLive2dVoiceChannelStore();
const avatarConfig = useSpotlightAvatarConfig();
const { message, speaking, revealInstant } = storeToRefs(speechStore);
const animatedText = ref("");
const copied = ref(false);
let typingTimer: number | null = null;
let copiedTimer: number | null = null;

const noticeText = computed(
  () => props.voiceError.trim() || props.phonePairError.trim(),
);

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

function dismissNotice(): void {
  if (props.voiceError.trim()) emit("dismissError");
  else emit("dismissPairError");
}

function openLocalPreview(): void {
  if (!props.phonePairUrl) return;
  window.open(props.phonePairUrl, "spotlight-voice-remote");
}

async function copyPairUrl(): Promise<void> {
  if (!props.phonePairUrl) return;
  try {
    await navigator.clipboard.writeText(props.phonePairUrl);
    copied.value = true;
    if (copiedTimer != null) window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    window.prompt("复制遥控器链接", props.phonePairUrl);
  }
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
  if (copiedTimer != null) window.clearTimeout(copiedTimer);
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

.live2d-voice-ring {
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    rgba(14, 165, 233, 0.08),
    #0ea5e9,
    #14b8a6,
    rgba(14, 165, 233, 0.08) 72%
  );
  opacity: 0;
  pointer-events: none;
  -webkit-mask: radial-gradient(
    farthest-side,
    transparent calc(100% - 3px),
    #000 calc(100% - 2px)
  );
  mask: radial-gradient(
    farthest-side,
    transparent calc(100% - 3px),
    #000 calc(100% - 2px)
  );
}

.live2d-voice-button.is-transcribing .live2d-voice-ring {
  opacity: 1;
  animation: voice-ring-spin 1.3s linear infinite;
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

.live2d-phone-button {
  margin-top: 2px;
  padding: 6px 12px;
  border: 1px solid rgba(20, 184, 166, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #0f766e;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
}

.live2d-phone-button.is-connected {
  border-color: rgba(16, 185, 129, 0.42);
  background: rgba(236, 253, 245, 0.94);
  color: #047857;
}

.live2d-phone-overlay,
.live2d-notice-overlay {
  --tb-text: #0f172a;
  --tb-text-muted: #64748b;
  --tb-border: rgba(148, 163, 184, 0.28);
  --tb-font:
    -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
    "Helvetica Neue", system-ui, sans-serif;
  position: fixed;
  inset: 0;
  z-index: 6200;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(10px) saturate(1.2);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  pointer-events: auto;
  font-family: var(--tb-font);
}

.live2d-notice-overlay {
  z-index: 6300;
}

.live2d-phone-panel,
.live2d-notice {
  position: relative;
  display: grid;
  gap: 10px;
  width: min(380px, calc(100vw - 32px));
  max-height: min(88vh, 720px);
  overflow: auto;
  padding: 0 0 16px;
  border: 1px solid var(--tb-border);
  border-radius: 22px;
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(248, 250, 252, 0.94) 55%,
    rgba(240, 253, 250, 0.92) 100%
  );
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.16),
    0 8px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  color: var(--tb-text);
}

.live2d-notice {
  width: min(360px, calc(100vw - 32px));
  max-height: min(70vh, 420px);
}

.live2d-phone-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 0 16px;
}

.live2d-phone-title-stack {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.live2d-phone-kicker {
  color: var(--tb-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.live2d-phone-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.35;
}

.live2d-phone-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 1px solid var(--tb-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--tb-text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.live2d-phone-hint {
  margin: 0;
  padding: 0 16px;
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
}

.live2d-phone-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 0 16px;
}

.live2d-phone-primary,
.live2d-phone-secondary {
  min-height: 36px;
  border: 0;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.live2d-phone-primary {
  background: linear-gradient(135deg, #14b8a6, #0ea5e9);
  color: #fff;
}

.live2d-phone-secondary {
  padding: 0 14px;
  border: 1px solid var(--tb-border);
  background: rgba(255, 255, 255, 0.88);
  color: #334155;
}

.live2d-phone-primary:disabled,
.live2d-phone-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.live2d-phone-qr {
  display: grid;
  place-items: center;
  margin: 0 16px;
  padding: 10px;
  border: 1px solid var(--tb-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.88);
}

.live2d-phone-qr :deep(svg) {
  width: min(196px, 58vw);
  height: auto;
  aspect-ratio: 1;
}

.live2d-phone-status {
  margin: 0;
  padding: 0 16px;
  color: #0f766e;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.live2d-notice-header {
  padding: 14px 16px 0;
}

.live2d-notice-body {
  margin: 0;
  padding: 0 16px;
  color: #334155;
  font-size: 14px;
  line-height: 1.55;
}

.live2d-notice-ok {
  min-height: 40px;
  margin: 4px 16px 0;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #14b8a6, #0ea5e9);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

@media (max-width: 720px) {
  .live2d-phone-actions {
    grid-template-columns: 1fr;
  }
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

@keyframes voice-ring-spin {
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
