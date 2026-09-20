import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../src/i18n/locales/en/translation.json";
import AccessibilityOnboarding from "../../src/components/onboarding/AccessibilityOnboarding";
import Onboarding from "../../src/components/onboarding/Onboarding";
import { useSettingsStore } from "../../src/stores/settingsStore";
import { useModelStore } from "../../src/stores/modelStore";
import "../../src/App.css";

const scenario = new URLSearchParams(location.search).get("scenario");
Object.assign(window, {
  __TAURI_OS_PLUGIN_INTERNALS__: { platform: "macos", os_type: "macos" },
});
const harness = {
  granted: scenario === "init-failure",
  failInit: scenario === "init-failure",
  failCheck: scenario === "check-failure",
  calls: [] as string[],
  completed: 0,
};
Object.assign(window, { onboardingHarness: harness });
mockIPC((command) => {
  harness.calls.push(command);
  if (command.includes("check_") && command.includes("permission")) {
    if (harness.failCheck) throw "Permission check unavailable";
    return harness.granted;
  }
  if (command === "initialize_enigo" && harness.failInit)
    throw "Keyboard initialization failed";
  if (command === "get_dictation_presets")
    return [
      { id: "fast", model_id: "fast-model" },
      { id: "accurate", model_id: "accurate-model" },
    ];
  return null;
});
await i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
useSettingsStore.setState({
  isLoading: false,
  refreshAudioDevices: async () => {},
  refreshOutputDevices: async () => {},
});
let resolveDownload: ((value: boolean) => void) | undefined;
useModelStore.setState({
  models: [
    { id: "fast-model", is_downloaded: false, size_mb: 640 },
    { id: "accurate-model", is_downloaded: true, size_mb: 1000 },
  ] as never[],
  loadModels: async () => {},
  downloadModel: async (id) => {
    useModelStore.setState({ downloadingModels: { [id]: true } });
    return new Promise<boolean>((resolve) => {
      resolveDownload = resolve;
    });
  },
  cancelDownload: async () => {
    useModelStore.setState({ downloadingModels: {} });
    resolveDownload?.(true);
    return true;
  },
  selectModel: async (id) => {
    useModelStore.setState({ currentModel: id });
    harness.calls.push("select-model");
    return true;
  },
});
function Fixture() {
  const [show, setShow] = useState(true);
  return (
    <>
      <button onClick={() => setShow(false)}>Unmount fixture</button>
      {show &&
        (scenario === "models" ? (
          <Onboarding
            onModelSelected={() => {
              harness.completed++;
            }}
          />
        ) : (
          <AccessibilityOnboarding
            preview={scenario === "preview"}
            onComplete={() => {
              harness.completed++;
              setShow(false);
            }}
          />
        ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
