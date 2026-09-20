import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Toaster } from "sonner";
import en from "../../src/i18n/locales/en/translation.json";
import { ShortcutInput } from "../../src/components/settings/ShortcutInput";
import { useSettingsStore } from "../../src/stores/settingsStore";
import type { AppSettings } from "../../src/bindings";
import "../../src/App.css";
const scenario = new URLSearchParams(location.search).get("scenario") || "";
Object.assign(window, {
  __TAURI_OS_PLUGIN_INTERNALS__: { platform: "macos", os_type: "macos" },
});
const harness = {
  calls: [] as string[],
  saved: [] as string[],
  resolveStart: () => {},
  emitKey: async (key: string, down: boolean, hotkey: string) =>
    emit("handy-keys-event", {
      key,
      is_key_down: down,
      hotkey_string: hotkey,
      modifiers: [],
    }),
};
Object.assign(window, { shortcutHarness: harness });
mockIPC(
  (command, args) => {
    harness.calls.push(command);
    if (
      command === "suspend_all_bindings" ||
      command === "start_handy_keys_recording"
    ) {
      if (scenario.includes("pending"))
        return new Promise((resolve) => {
          harness.resolveStart = () => resolve(null);
        });
      return null;
    }
    if (command === "change_binding") {
      if (scenario.includes("failure"))
        return { success: false, error: "Shortcut unavailable" };
      harness.saved.push(String(args.binding));
      return { success: true };
    }
    return null;
  },
  { shouldMockEvents: true },
);
await i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
useSettingsStore.setState({
  isLoading: false,
  settings: {
    keyboard_implementation: scenario.includes("native")
      ? "handy_keys"
      : "tauri",
    bindings: {
      transcribe: {
        id: "transcribe",
        name: "Dictate",
        description: "Dictate",
        current_binding: "option+space",
      },
      transcribe_with_post_process: { current_binding: "control+k" },
    },
  } as unknown as AppSettings,
});
function Fixture() {
  const [show, setShow] = useState(true);
  return (
    <>
      <button onClick={() => setShow(false)}>Unmount fixture</button>
      {show && <ShortcutInput shortcutId="transcribe" />}
      <Toaster />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
