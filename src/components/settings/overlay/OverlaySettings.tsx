import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ShowOverlay } from "../ShowOverlay";

export const OverlaySettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup
        title={t("sidebar.overlay")}
        description={t("settings.overlay.description")}
      >
        <ShowOverlay descriptionMode="tooltip" grouped />
      </SettingsGroup>
    </div>
  );
};
