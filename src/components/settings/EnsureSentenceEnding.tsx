import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface EnsureSentenceEndingProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const EnsureSentenceEnding: React.FC<EnsureSentenceEndingProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("ensure_sentence_ending") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(enabled) => updateSetting("ensure_sentence_ending", enabled)}
        isUpdating={isUpdating("ensure_sentence_ending")}
        label={t("settings.debug.ensureSentenceEnding.label")}
        description={t("settings.debug.ensureSentenceEnding.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });
