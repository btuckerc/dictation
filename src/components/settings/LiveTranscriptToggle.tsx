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
  const style = getSetting("overlay_style") || "minimal";
  const change = async (show: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const nextStyle = show ? "live" : style === "none" ? "none" : "minimal";
      await invoke("change_overlay_style_setting", { style: nextStyle });
      useSettingsStore.setState((state) => ({
        settings: state.settings
          ? { ...state.settings, overlay_style: nextStyle }
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
        checked={style === "live"}
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
