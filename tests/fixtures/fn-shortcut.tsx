import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Toaster } from "sonner";
import en from "../../src/i18n/locales/en/translation.json";
import FnShortcutHelp from "../../src/components/settings/FnShortcutHelp";
import { useSettingsStore } from "../../src/stores/settingsStore";
import type { AppSettings } from "../../src/bindings";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") || "fn";
const binding =
  scenario === "secondary"
    ? "option+space"
    : scenario === "function"
      ? " function "
      : scenario === "nonfn"
        ? "option+space"
        : "fn";
const postProcessBinding = scenario === "secondary" ? "function" : "control+k";

Object.assign(window, {
  __TAURI_OS_PLUGIN_INTERNALS__: {
    platform: scenario === "nonmac" ? "windows" : "macos",
    os_type: scenario === "nonmac" ? "windows" : "macos",
  },
});

const openerCalls: string[] = [];
Object.assign(window, { fnShortcutHarness: { openerCalls } });
mockIPC((command, args) => {
  if (command === "plugin:opener|open_url") {
    openerCalls.push(String((args as { url?: string }).url));
    if (scenario === "open-failure")
      return Promise.reject(new Error("open failed"));
  }
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
    bindings: {
      transcribe: { current_binding: binding },
      transcribe_with_post_process: { current_binding: postProcessBinding },
    },
  } as unknown as AppSettings,
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FnShortcutHelp />
    <Toaster />
  </React.StrictMode>,
);
