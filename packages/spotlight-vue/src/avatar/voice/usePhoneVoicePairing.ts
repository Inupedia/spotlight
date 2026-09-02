import { computed, onUnmounted, ref } from "vue";
import { renderSVG } from "uqr";
import { getSpotlightJson, postSpotlightJson } from "../../remote/serverJson.js";
import {
  createVoiceRemoteSession,
  pullVoiceRemoteUtterances,
  voiceRemotePageUrl,
} from "./phonePairing.js";

export function usePhoneVoicePairing(options: {
  enabled: boolean;
  onUtterance: (text: string) => Promise<void>;
}) {
  const token = ref("");
  const pairUrl = ref("");
  const qrSvg = ref("");
  const phoneConnected = ref(false);
  const pairError = ref("");
  const panelOpen = ref(false);
  let pollTimer: number | null = null;
  let submitting = false;

  const canShow = computed(() => options.enabled);

  function stopPolling() {
    if (pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function renderPairQr() {
    if (!token.value) return;
    pairUrl.value = voiceRemotePageUrl(token.value);
    qrSvg.value = renderSVG(pairUrl.value, {
      border: 2,
      ecc: "M",
      pixelSize: 4,
      blackColor: "#0f172a",
      whiteColor: "#ffffff",
    });
  }

  async function ensureSession() {
    if (typeof window === "undefined") return;
    if (window.location.pathname.includes("voice-remote")) return;
    if (token.value) return;
    try {
      const created = await createVoiceRemoteSession(postSpotlightJson);
      token.value = created.token;
      renderPairQr();
      pairError.value = "";
    } catch (error) {
      pairError.value =
        error instanceof Error ? error.message : "无法创建手机配对。";
    }
  }

  async function poll() {
    if (submitting) return;
    if (!token.value) {
      await ensureSession();
      if (!token.value) return;
    }
    try {
      const [pending, session] = await Promise.all([
        pullVoiceRemoteUtterances(token.value, getSpotlightJson),
        getSpotlightJson<{ phoneConnected?: boolean }>(
          `/v1/voice-remote/sessions/${encodeURIComponent(token.value)}`,
        ).catch((error: { code?: string; status?: number }) => {
          if (error.code === "VOICE_REMOTE_EXPIRED" || error.status === 404) {
            token.value = "";
            void ensureSession();
          }
          return null;
        }),
      ]);
      if (session && "phoneConnected" in session) {
        phoneConnected.value = Boolean(session.phoneConnected);
      }
      for (const utterance of pending) {
        const text = utterance.text?.trim();
        if (!text) continue;
        submitting = true;
        try {
          await options.onUtterance(text);
        } finally {
          submitting = false;
        }
      }
    } catch {
      // Keep the QR up; the next tick retries.
    }
  }

  function startPolling() {
    stopPolling();
    void ensureSession().then(() => {
      void poll();
      pollTimer = window.setInterval(() => {
        void poll();
      }, 1200);
    });
  }

  function openPanel() {
    panelOpen.value = true;
    startPolling();
  }

  function closePanel() {
    panelOpen.value = false;
  }

  function clearPairError() {
    pairError.value = "";
  }

  onUnmounted(() => {
    stopPolling();
  });

  return {
    canShow,
    pairUrl,
    qrSvg,
    phoneConnected,
    pairError,
    panelOpen,
    openPanel,
    closePanel,
    clearPairError,
    startPolling,
    ensureSession,
  };
}
