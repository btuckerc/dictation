import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";
import en from "../../src/i18n/locales/en/translation.json";
import { HistoryEntryComponent } from "../../src/components/settings/history/HistorySettings";
import { AudioPlayerGroup } from "../../src/components/ui/AudioPlayer";
import type { HistoryEntry } from "../../src/bindings";
import "../../src/App.css";

const longUnbrokenText =
  "https://example.com/" +
  "a-really-long-identifier-that-must-wrap-in-the-expanded-history-transcript-".repeat(
    4,
  );
const entries: HistoryEntry[] = [
  {
    id: 1,
    file_name: "short.wav",
    timestamp: 0,
    saved: false,
    title: "Short",
    transcription_text:
      "A short transcript.\nA second line that starts hidden.",
    post_processed_text: null,
    post_process_prompt: null,
    post_process_requested: false,
  },
  {
    id: 2,
    file_name: "long.wav",
    timestamp: 0,
    saved: false,
    title: "Long",
    transcription_text:
      "This transcript is long enough to verify that the row stays compact until it is expanded. ".repeat(
        8,
      ),
    post_processed_text: null,
    post_process_prompt: null,
    post_process_requested: false,
  },
  {
    id: 3,
    file_name: "identifier.wav",
    timestamp: 0,
    saved: false,
    title: "Identifier",
    transcription_text: longUnbrokenText,
    post_processed_text: null,
    post_process_prompt: null,
    post_process_requested: false,
  },
];

if (new URLSearchParams(location.search).has("replacements")) {
  entries[0].transcription_text = "two people";
  entries[0].post_processed_text = "2 people";
}

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <AudioPlayerGroup>
      <main style={{ width: "360px", padding: "16px" }}>
        {entries.map((entry) => (
          <HistoryEntryComponent
            key={entry.id}
            entry={entry}
            onToggleSaved={() => {}}
            onCopyText={(text) => {
              document.body.dataset.copiedText = text;
            }}
            getAudioUrl={async () => null}
            deleteAudio={async () => {}}
            retryTranscription={async () => {}}
          />
        ))}
      </main>
    </AudioPlayerGroup>
  </I18nextProvider>,
);
