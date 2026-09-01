export {
  defineSpotlightConfig,
  SPOTLIGHT_CONFIG_KEY,
  type SpotlightConfig,
  type SpotlightQuickPanelActions,
  type SpotlightVuePluginOptions,
} from "./config.js";
export {
  readSpotlightEnv,
  type SpotlightEnvDefaults,
} from "./env.js";
export { mergeSpotlightSkills } from "./host/mergeSkills.js";
export {
  getSpotlightConfig,
  getSpotlightClientTools,
  getSpotlightAppClient,
  getSpotlightHttp,
  SpotlightVue,
  SPOTLIGHT_CLIENT_TOOLS_KEY,
  SPOTLIGHT_APP_CLIENT_KEY,
  SPOTLIGHT_HTTP_KEY,
} from "./plugin.js";

export {
  useSpotlightStore,
  SpotlightIntent,
  SPOTLIGHT_INTENT_LABELS,
  ProgressSubIntent,
  PROGRESS_SUB_INTENT_LABELS,
  InvestmentSubIntent,
  INVESTMENT_SUB_INTENT_LABELS,
  QualitySubIntent,
  QUALITY_SUB_INTENT_LABELS,
  SafetySubIntent,
  SAFETY_SUB_INTENT_LABELS,
  SUB_INTENT_CONFIG,
  type AgentStep,
  type IntentWithReason,
  type SubIntentConfig,
  type SpotlightSkillPermissionRequest,
} from "./store/spotlightStore.js";

export {
  SpotlightCommandDomain,
  SpotlightCommandScope,
  type SpotlightCommand,
  type SpotlightCommandAction,
  type SpotlightCommandTarget,
} from "./store/types.js";

export { useSpotlightRuntimeStore } from "./store/runtimeStore.js";
export { useAgentSessionStore } from "./session/agentSession.js";
export {
  useSpotlightMemoryPreferenceStore,
  readSpotlightMemoryEnabled,
} from "./store/memoryPreferenceStore.js";

export {
  getSkillsPoolForRun,
  loadBundledSkillsFromGlob,
  parseSpotlightSkillMarkdown,
  formatSkillsWithinBudget,
  getBypassMatchedSkills,
  getModelInvokableSkills,
} from "./skills/index.js";

export {
  cancelRemoteSpotlightRunForSignal,
  runRemoteSpotlightPipeline,
  warmupSpotlightRemoteContext,
  ensureSpotlightMeta,
  getSpotlightUiPrompts,
  spotlightSynthesizeSpeech,
  spotlightTranscribeAudio,
  extractTranscriptionText,
  normalizeSpeakText,
  postSpotlightJson,
  getSpotlightJson,
  type SpotlightUiPrompts,
  type SpotlightPipelineRunOutcome,
} from "./remote/index.js";

export { TOOL_NAMES } from "./constants/toolNames.js";
export {
  getIntentStepDisplayContent,
  humanizeSpotlightStepContent,
  isAnswerStep,
  isToolExecutionStep,
  parseGatherProcessDisplay,
  formatGatherProcessText,
  sanitizeToolStepAnswerText,
  splitToolStepContent,
  composeToolStepContent,
  isLoopPlanningChunk,
  splitIntentStepContent,
  stripInternalEvidenceAnswer,
} from "./store/pipeline/displayText.js";
export { partitionToolCalls } from "./store/pipeline/toolDisplay.js";
export {
  isInternalKnowledgeEvidenceTool,
  isUserFacingKnowledgeTool,
} from "./store/pipeline/toolDisplay.js";
export { TOOL_STEP_ANSWER_DELIMITER } from "./store/pipeline/displayText.js";
export {
  SPOTLIGHT_PIPELINE_STEP_IDS,
  SPOTLIGHT_PIPELINE_STEP_LABELS,
} from "./store/pipeline/constants.js";
export { initSpotlightMarkdownPreview } from "./store/pipeline/spotlightMarkdown.js";
export {
  formatSpotlightKnowledgeMarkdown,
  preprocessKnowledgeMarkdown,
} from "./store/pipeline/spotlightMarkdown.js";
export { formatToolFailure } from "./store/pipeline/errors.js";
export { getSuggestedQuestions } from "./store/capabilities.js";
export { useSpotlightPanelUi } from "./composables/useSpotlightPanelUi.js";
export { useSpotlightCommandShortcuts } from "./composables/useSpotlightCommandShortcuts.js";
export { isGenericHostExecutionReply } from "./avatar/speech/live2dAnswerSpeechPolicy.js";
export type { SpotlightAvatarConfig } from "./avatar/config.js";
export {
  VoiceTurnController,
  type SpotlightVoiceConfig,
  type SpotlightVoicePhase,
} from "@inupedia/spotlight-protocol";

export type { ToolResult, ToolTraceEvent } from "./types/toolResult.js";
export type { SessionControlIntent } from "./types/session.js";
export type { HandlerApi, SpotlightContext } from "./store/pipeline/types.js";
export type { SpotlightVideoChannelId } from "./store/types.js";
