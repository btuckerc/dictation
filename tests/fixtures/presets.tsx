// Browser-only regression fixture. Never included in the production entrypoint.
import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../src/i18n/locales/en/translation.json";
import { useModelStore } from "../../src/stores/modelStore";
import { useSettingsStore } from "../../src/stores/settingsStore";
import { DictationPresets } from "../../src/components/settings/general/DictationPresets";
import type { ModelInfo, AppSettings } from "../../src/bindings";

const scenario = new URLSearchParams(location.search).get("scenario");
mockIPC((command) => {
  if (command === "get_dictation_presets")
    return [
      { id: "fast", model_id: "fast-model" },
      { id: "accurate", model_id: "accurate-model" },
    ];
  if (command === "change_post_process_base_url_setting")
    throw new Error("Cannot save endpoint");
  return null;
});
await i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
useSettingsStore.setState({
  isLoading: false,
  settings: {
    custom_words: [],
    post_process_enabled: false,
    post_process_providers: [],
    post_process_models: {},
  } as unknown as AppSettings,
});
useModelStore.setState({
  currentModel: "accurate-model",
  models: [
    { id: "fast-model", is_downloaded: true },
    { id: "accurate-model", is_downloaded: true },
  ] as ModelInfo[],
  loadModels: async () => {},
  selectModel: async (id) => {
    if (scenario === "failure") return false;
    useModelStore.setState({ currentModel: id });
    return true;
  },
});
createRoot(document.getElementById("root")!).render(
  <DictationPresets
    onSelected={
      scenario === "cleanup"
        ? undefined
        : () => {
            document.body.dataset.selected = "true";
          }
    }
  />,
);
