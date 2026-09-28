<template>
  <div
    class="spotlight-backdrop"
    :inert="modelPickerOpen"
    @click.self="store.close"
  >
    <div
      class="spotlight-panel"
      :class="{ 'is-memory-on': memoryPreference.enabled }"
      role="dialog"
      :aria-modal="modelPickerOpen ? 'false' : 'true'"
      aria-label="指令面板"
    >
      <OfficialBorderBeam
        v-if="memoryPreference.enabled"
        class="spotlight-panel-beam"
        :size="120"
        :duration="22"
        :border-width="1.5"
        color-from="#5eead4"
        color-to="#38bdf8"
      />
      <div class="spotlight-command-deck">
        <div class="spotlight-command-deck-meta">
          <span v-if="deckKicker" class="spotlight-command-deck-kicker">{{
            deckKicker
          }}</span>
          <span class="spotlight-command-deck-status">{{ badgeLabel }}</span>
        </div>
        <div class="spotlight-command-deck-actions">
          <button
            type="button"
            class="spotlight-memory-dot-btn"
            role="switch"
            :aria-checked="memoryPreference.enabled"
            :aria-label="
              getSpotlightMemoryPreferenceCopy(memoryPreference.enabled).ariaLabel
            "
            :title="
              getSpotlightMemoryPreferenceCopy(memoryPreference.enabled).title
            "
            @click="memoryPreference.toggle()"
          >
            <span class="spotlight-memory-label">{{
              SPOTLIGHT_MEMORY_PREFERENCE_LABEL
            }}</span>
            <span
              class="spotlight-memory-dot"
              :class="{ 'is-on': memoryPreference.enabled }"
            />
          </button>
          <button
            ref="modelTriggerRef"
            type="button"
            class="spotlight-model-settings"
            aria-haspopup="dialog"
            :aria-expanded="modelPickerOpen"
            aria-controls="spotlight-model-dialog"
            :aria-label="modelPreference.selectedModel ? `模型设置，当前 ${modelPreference.selectedModel}` : '模型设置'"
            :title="modelPreference.error || '模型设置'"
            @click="openModelPicker"
          >
            <Settings2 :size="17" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        v-if="store.pendingSkillPermission"
        class="spotlight-permission-banner"
        role="alertdialog"
        aria-label="Skill 权限确认"
      >
        <div class="spotlight-permission-banner-body">
          <strong>{{
            store.pendingSkillPermission.displayName ??
            store.pendingSkillPermission.skillName
          }}</strong>
          <span>{{ store.pendingSkillPermission.reason }}</span>
        </div>
        <div class="spotlight-permission-banner-actions">
          <button
            type="button"
            class="spotlight-permission-btn is-approve"
            @click="store.approvePendingSkillPermission()"
          >
            允许
          </button>
          <button
            type="button"
            class="spotlight-permission-btn is-dismiss"
            @click="store.clearPendingSkillPermission()"
          >
            取消
          </button>
        </div>
      </div>
      <InspiraCardSpotlight
        class="spotlight-input-shell"
        :gradient-size="260"
        gradient-color="rgba(45, 212, 191, 0.14)"
        :gradient-opacity="1"
      >
        <div
          v-if="voiceHoldActive || speechPending"
          class="spotlight-voice-shell"
          :class="{
            'is-recording': voiceHoldActive,
            'is-transcribing': speechPending,
          }"
        >
          <OfficialBorderBeam
            class="spotlight-voice-beam"
            :size="86"
            :duration="6"
            :border-width="1.5"
            color-from="#c9a25d"
            color-to="#5d8f9b"
          />
          <div class="spotlight-voice-mic" aria-hidden="true">
            <span class="spotlight-voice-mic-icon">
              <span class="spotlight-voice-mic-body" />
              <span class="spotlight-voice-mic-stem" />
            </span>
          </div>
          <div class="spotlight-voice-text">
            {{
              voiceHoldActive
                ? `正在录音，松开 ${voiceKeyLabel} 结束`
                : "语音识别中，请稍候…"
            }}
          </div>
        </div>
        <div v-else class="spotlight-input-wrap" :class="`is-${uiState}`">
          <!-- prettier-ignore -->
          <input
            ref="inputRef"
            v-model="store.prompt"
            class="spotlight-input"
            type="text"
            :placeholder="placeholder"
            @keydown.enter.prevent="store.handleEnter"
            @keydown.down.prevent="store.selectNext"
            @keydown.up.prevent="store.selectPrev"
          >
          <div class="spotlight-agent-badge" :class="`is-${uiState}`">
            <span class="spotlight-agent-badge-dot" />
            <span>{{ badgeLabel }}</span>
          </div>
        </div>
      </InspiraCardSpotlight>
      <div
        v-if="
          !store.prompt.trim() &&
          !store.loading &&
          !voiceHoldActive &&
          !speechPending
        "
        class="spotlight-list-shell"
      >
        <ul class="spotlight-list" role="listbox">
          <li
            v-for="(q, i) in store.suggestedQuestions"
            :key="`suggested-${i}`"
            class="spotlight-item"
            :class="{ 'is-selected': store.selectedIndex === i }"
            role="option"
            :aria-selected="store.selectedIndex === i"
            @click="onSelectQuestion(i)"
          >
            <span class="spotlight-item-label">{{ q }}</span>
            <span class="spotlight-item-hint">推荐</span>
          </li>
          <li
            v-if="
              store.suggestedQuestions.length > 0 &&
              store.recentQuestions.length > 0
            "
            class="spotlight-list-divider"
          >
            <span>历史问题</span>
          </li>
          <li
            v-for="(q, i) in store.recentQuestions"
            :key="`recent-${i}`"
            class="spotlight-item"
            :class="{
              'is-selected':
                store.selectedIndex === i + store.suggestedQuestions.length,
            }"
            role="option"
            :aria-selected="
              store.selectedIndex === i + store.suggestedQuestions.length
            "
            @click="onSelectQuestion(i + store.suggestedQuestions.length)"
          >
            <span class="spotlight-item-label">{{ q }}</span>
            <span class="spotlight-item-hint">历史</span>
          </li>
          <li
            v-if="
              store.suggestedQuestions.length === 0 &&
              store.recentQuestions.length === 0
            "
            class="spotlight-item spotlight-item--empty"
          >
            <span class="spotlight-item-label">暂无推荐问法</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <dialog
      id="spotlight-model-dialog"
      ref="modelDialogRef"
      class="spotlight-model-dialog"
      aria-labelledby="spotlight-model-title"
      aria-describedby="spotlight-model-description"
      @cancel.prevent="closeModelPicker"
      @click.self="closeModelPicker"
      @close="modelPickerOpen = false"
    >
      <section class="spotlight-model-dialog-content">
        <header class="spotlight-model-dialog-header">
          <div class="spotlight-model-dialog-heading">
            <span class="spotlight-model-dialog-eyebrow">SPOTLIGHT 设置</span>
            <h2 id="spotlight-model-title">选择模型</h2>
            <p id="spotlight-model-description">
              选择后将用于接下来的 Spotlight 请求。
            </p>
          </div>
          <button
            type="button"
            class="spotlight-model-dialog-close"
            aria-label="关闭模型选择"
            @click="closeModelPicker"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <label class="spotlight-model-search">
          <span class="spotlight-model-search-icon" aria-hidden="true">⌕</span>
          <span class="spotlight-sr-only">搜索模型</span>
          <input
            id="spotlight-model-search"
            ref="modelSearchRef"
            v-model="modelSearch"
            type="search"
            autocomplete="off"
            placeholder="搜索模型名称"
          >
        </label>

        <div class="spotlight-model-dialog-status" aria-live="polite">
          <span v-if="modelPreference.loading">正在同步模型列表…</span>
          <span v-else-if="modelPreference.error" class="is-error">
            {{ modelPreference.error }}
          </span>
          <span v-else-if="filteredModels.length">
            {{ filteredModels.length }} 个可用模型
          </span>
          <span v-else>没有找到匹配的模型</span>
          <button
            type="button"
            class="spotlight-model-refresh"
            :disabled="modelPreference.loading"
            @click="modelPreference.loadModels(true)"
          >
            {{ modelPreference.loading ? '同步中…' : '刷新列表' }}
          </button>
        </div>

        <div class="spotlight-model-results" aria-label="可用模型">
          <button
            v-for="model in filteredModels"
            :key="model.id"
            type="button"
            class="spotlight-model-option"
            :class="{ 'is-selected': model.id === modelPreference.selectedModel }"
            :aria-pressed="model.id === modelPreference.selectedModel"
            @click="selectModel(model.id)"
          >
            <span class="spotlight-model-option-copy">
              <span class="spotlight-model-option-name">{{ model.id }}</span>
              <span class="spotlight-model-option-provider">
                {{ model.ownedBy || 'SiliconFlow' }}
              </span>
            </span>
            <span
              v-if="model.id === modelPreference.selectedModel"
              class="spotlight-model-option-check"
              aria-hidden="true"
            >
              ✓
            </span>
          </button>
          <div
            v-if="!modelPreference.loading && modelPreference.models.length === 0"
            class="spotlight-model-empty"
          >
            <strong>暂时无法获取模型</strong>
            <span>请检查 Spotlight Server 与模型服务商连接后重试。</span>
          </div>
        </div>

        <footer class="spotlight-model-dialog-footer">
          <span>当前选择会保存在此项目的浏览器中。</span>
          <button
            type="button"
            class="spotlight-model-done"
            @click="closeModelPicker"
          >
            完成
          </button>
        </footer>
      </section>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef } from "vue";
import { Settings2 } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { useSpotlightStore } from "../store/spotlightStore.js";
import { useSpotlightMemoryPreferenceStore } from "../store/memoryPreferenceStore.js";
import { useSpotlightModelStore } from "../store/modelStore.js";
import {
  getSpotlightMemoryPreferenceCopy,
  SPOTLIGHT_MEMORY_PREFERENCE_LABEL,
} from "../store/memoryPreferenceCopy.js";
import { useSpotlightPanelUi } from "../composables/useSpotlightPanelUi.js";
import InspiraCardSpotlight from "./InspiraCardSpotlight.vue";
import OfficialBorderBeam from "./OfficialBorderBeam.vue";

const props = withDefaults(
  defineProps<{
    deckKicker?: string;
    voiceHoldActive?: boolean;
    speechPending?: boolean;
    voiceKeyLabel?: string;
  }>(),
  {
    deckKicker: "",
    voiceHoldActive: false,
    speechPending: false,
    voiceKeyLabel: "`",
  },
);

const store = useSpotlightStore();
const memoryPreference = useSpotlightMemoryPreferenceStore();
const modelPreference = useSpotlightModelStore();
const { loading, pipelinePhase, lastMemoryReplay, lastMemoryDecision } =
  storeToRefs(store);
const inputRef = ref<HTMLInputElement | null>(null);
const modelPickerOpen = ref(false);
const modelSearch = ref("");
const modelDialogRef = ref<HTMLDialogElement | null>(null);
const modelSearchRef = ref<HTMLInputElement | null>(null);
const modelTriggerRef = ref<HTMLButtonElement | null>(null);
const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLocaleLowerCase();
  if (!query) return modelPreference.models;
  return modelPreference.models.filter((model) =>
    model.id.toLocaleLowerCase().includes(query),
  );
});

onMounted(() => {
  void modelPreference.loadModels();
});

function openModelPicker() {
  const dialog = modelDialogRef.value;
  if (!dialog || dialog.open) return;
  modelPickerOpen.value = true;
  modelSearch.value = "";
  dialog.showModal();
  void nextTick(() => modelSearchRef.value?.focus());
}

function closeModelPicker() {
  const dialog = modelDialogRef.value;
  if (dialog?.open) dialog.close();
  modelPickerOpen.value = false;
  void nextTick(() => modelTriggerRef.value?.focus());
}

function selectModel(modelId: string) {
  modelPreference.selectModel(modelId);
  closeModelPicker();
}

const { uiState, placeholder, badgeLabel } = useSpotlightPanelUi({
  pipelinePhase,
  loading,
  memoryReplay: lastMemoryReplay,
  memoryDecision: lastMemoryDecision,
  voiceHoldActive: toRef(props, "voiceHoldActive"),
  speechPending: toRef(props, "speechPending"),
  voiceKeyLabel: props.voiceKeyLabel,
});

function onSelectQuestion(index: number) {
  store.fillPromptWithRecent(index);
  nextTick(() => inputRef.value?.focus());
}

function focusInput() {
  nextTick(() => inputRef.value?.focus());
}

defineExpose({ focusInput });
</script>

<style scoped>
@import "../styles/spotlight-command-panel.css";
</style>
