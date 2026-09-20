import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import i18n from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";
import en from "../../src/i18n/locales/en/translation.json";
import { useSettingsStore } from "../../src/stores/settingsStore";
import { AboutSettings } from "../../src/components/settings/about/AboutSettings";
import { WhatsNewModal } from "../../src/components/whats-new/WhatsNewModal";
import { findLatestReleaseNote } from "../../src/components/whats-new/releaseNotes";
import type { AppSettings } from "../../src/bindings";
import "../../src/App.css";

Object.assign(window, {
  __TAURI_OS_PLUGIN_INTERNALS__: {
    platform: "linux",
    os_type: "linux",
  },
});

mockIPC((command) => {
  if (command === "plugin:app|get_version") return "0.1.0";
  if (command === "get_app_dir_path" || command === "get_log_dir_path") {
    return "/tmp/Dictation";
  }
  if (command === "plugin:opener|open_url") return null;
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
    app_language: "en",
    theme: "system",
    show_whats_new_on_update: true,
    whats_new_last_seen_version: "0.1.0",
  } as unknown as AppSettings,
});

const latestNote = findLatestReleaseNote();

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <AboutSettings />
    {latestNote && (
      <WhatsNewModal note={latestNote} open={true} onDismiss={() => {}} />
    )}
    <output data-testid="latest-note-version">
      {latestNote?.version ?? "missing"}
    </output>
  </I18nextProvider>,
);
