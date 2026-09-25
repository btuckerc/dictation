import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSettings } from "@/hooks/useSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";

export function LiveTranscriptToggle() {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = getSetting("live_transcript") ?? true;
  const change = async (show: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("change_live_transcript_setting", { enabled: show });
      useSettingsStore.setState((state) => ({
        settings: state.settings
          ? { ...state.settings, live_transcript: show }
          : null,
      }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ToggleSwitch
        label={t("dictation.overlay.showWords")}
        description={t("dictation.overlay.description")}
        descriptionMode="tooltip"
        grouped
        checked={live}
        isUpdating={busy}
        onChange={(show) => void change(show)}
      />
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-error">
          {error}
        </p>
      )}
    </>
  );
}
