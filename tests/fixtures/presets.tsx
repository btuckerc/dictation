import { AccentColor } from "../../src/components/settings/AccentColor";
import { applyAccent, DEFAULT_ACCENT } from "../../src/lib/utils/accent";
import { SettingsGroup } from "../../src/components/ui/SettingsGroup";
import "../../src/App.css";
// Browser-only regression fixture. Never included in the production entrypoint.
import React from "react";
import { LiveTranscriptToggle } from "../../src/components/settings/LiveTranscriptToggle";
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
mockIPC((command, args) => {
  if (command === "change_dictation_accent") {
    if (scenario === "accent-failure") throw new Error("Cannot save accent");
    localStorage.setItem("accent", (args as { color: string }).color);
  }
  if (command === "change_overlay_style_setting") {
    if (scenario === "overlay-failure") throw new Error("Cannot save overlay");
    localStorage.setItem("overlay_style", (args as { style: string }).style);
  }
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
    overlay_style:
      localStorage.getItem("overlay_style") ||
      (scenario === "overlay-none" ? "none" : "live"),
    accent_color: localStorage.getItem("accent") || DEFAULT_ACCENT,
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
applyAccent(localStorage.getItem("accent") || DEFAULT_ACCENT);
createRoot(document.getElementById("root")!).render(
  scenario?.startsWith("accent") ? (
    <SettingsGroup>
      <AccentColor />
    </SettingsGroup>
  ) : scenario?.startsWith("overlay") ? (
    <LiveTranscriptToggle />
  ) : (
    <DictationPresets
      onSelected={
        scenario === "cleanup"
          ? undefined
          : () => {
              document.body.dataset.selected = "true";
            }
      }
    />
  ),
);
