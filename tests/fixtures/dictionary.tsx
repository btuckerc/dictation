import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../src/i18n/locales/en/translation.json";
import { CustomWords } from "../../src/components/settings/CustomWords";
import { useSettingsStore } from "../../src/stores/settingsStore";
import type { AppSettings } from "../../src/bindings";
import "../../src/App.css";

const scenario = new URLSearchParams(location.search).get("scenario");
const initialWords = ["Nous", "OpenAI", "MacBook Pro"];

mockIPC((command, args) => {
  if (command === "update_custom_words") {
    if (scenario === "failure") throw new Error("Cannot save dictionary");
    localStorage.setItem(
      "custom_words",
      JSON.stringify((args as { words: string[] }).words),
    );
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
    custom_words: scenario === "empty" ? [] : initialWords,
  } as unknown as AppSettings,
});

createRoot(document.getElementById("root")!).render(
  <div className="max-w-3xl p-4">
    <CustomWords grouped />
  </div>,
);
