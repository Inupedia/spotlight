import { defineStore } from "pinia";
import { getSpotlightConfig } from "../plugin.js";
import { appendSpotlightProjectQuery } from "../remote/httpConfig.js";
import { getSpotlightJson } from "../remote/serverJson.js";

export type SpotlightModel = { id: string; ownedBy?: string };

let modelLoadPromise: Promise<void> | null = null;

function storageKey(): string {
  return `spotlight:model:${getSpotlightConfig().projectId}`;
}

function readSavedModel(): string {
  try {
    return globalThis.localStorage?.getItem(storageKey()) ?? "";
  } catch {
    return "";
  }
}

export const useSpotlightModelStore = defineStore("spotlight-model", {
  state: () => ({
    models: [] as SpotlightModel[],
    selectedModel: readSavedModel(),
    modelsLoaded: false,
    loading: false,
    error: "",
  }),
  actions: {
    async loadModels(force = false) {
      if (modelLoadPromise) return modelLoadPromise;
      if (this.modelsLoaded && !force) return;

      this.loading = true;
      this.error = "";
      const loadPromise = (async () => {
        try {
          const response = await getSpotlightJson<{
            models: SpotlightModel[];
            defaultModel?: string | null;
          }>(appendSpotlightProjectQuery("/v1/meta/models"));
          const models = Array.isArray(response.models)
            ? response.models.filter(
                (model) =>
                  model && typeof model.id === "string" && model.id.trim(),
              )
            : [];
          this.models = models;
          const saved = this.selectedModel || readSavedModel();
          this.selectedModel = models.some((model) => model.id === saved)
            ? saved
            : models.some((model) => model.id === response.defaultModel)
              ? response.defaultModel!
              : (models[0]?.id ?? "");
          this.modelsLoaded = true;
          this.persistSelection();
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        } finally {
          this.loading = false;
        }
      })();
      modelLoadPromise = loadPromise;
      try {
        await loadPromise;
      } finally {
        if (modelLoadPromise === loadPromise) modelLoadPromise = null;
      }
    },
    selectModel(modelId: string) {
      if (!this.models.some((model) => model.id === modelId)) return;
      this.selectedModel = modelId;
      this.persistSelection();
    },
    persistSelection() {
      try {
        if (this.selectedModel) {
          globalThis.localStorage?.setItem(storageKey(), this.selectedModel);
        }
      } catch {
        // Model selection still applies to this page when storage is unavailable.
      }
    },
  },
});
