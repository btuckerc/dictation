import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import type {
  OverlayColor,
  OverlayDesign,
  OverlayPosition,
  OverlayShape,
  OverlaySpeech,
} from "@/bindings";

interface ShowOverlayProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ShowOverlay: React.FC<ShowOverlayProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const positionOptions = [
      {
        value: "bottom",
        label: t("settings.advanced.overlay.position.options.bottom"),
      },
      {
        value: "top",
        label: t("settings.advanced.overlay.position.options.top"),
      },
    ];

    const designOptions = [
      {
        value: "pill",
        label: t("settings.advanced.overlay.design.options.pill"),
      },
      {
        value: "orb",
        label: t("settings.advanced.overlay.design.options.orb"),
      },
    ];

    const speechOptions = [
      {
        value: "ribbon",
        label: t("settings.advanced.overlay.speech.options.ribbon"),
      },
      {
        value: "prism",
        label: t("settings.advanced.overlay.speech.options.prism"),
      },
    ];

    const colorOptions = [
      {
        value: "rainbow",
        label: t("settings.advanced.overlay.color.options.rainbow"),
      },
      {
        value: "accent",
        label: t("settings.advanced.overlay.color.options.accent"),
      },
    ];

    const shapeOptions = [
      {
        value: "capsule",
        label: t("settings.advanced.overlay.shape.options.capsule"),
      },
      {
        value: "circle",
        label: t("settings.advanced.overlay.shape.options.circle"),
      },
    ];

    // Missing from very old stores only; settings.rs migrates it on load.
    const shown = getSetting("show_overlay") ?? true;
    // Only "top" and "bottom" are selectable; anything else (empty, or a legacy
    // "none" from before the position was retired) falls back to "bottom".
    const selectedPosition: OverlayPosition =
      getSetting("overlay_position") === "top" ? "top" : "bottom";
    const selectedDesign: OverlayDesign =
      getSetting("overlay_design") === "orb" ? "orb" : "pill";
    const selectedSpeech: OverlaySpeech =
      getSetting("overlay_speech") === "prism" ? "prism" : "ribbon";
    const selectedColor: OverlayColor =
      getSetting("overlay_color") === "accent" ? "accent" : "rainbow";
    const selectedShape: OverlayShape =
      getSetting("overlay_shape") === "circle" ? "circle" : "capsule";
    const showOrbOptions = shown && selectedDesign === "orb";

    return (
      <>
        <ToggleSwitch
          label={t("settings.advanced.overlay.show.title")}
          description={t("settings.advanced.overlay.show.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
          checked={shown}
          isUpdating={isUpdating("show_overlay")}
          onChange={(enabled) => updateSetting("show_overlay", enabled)}
        />

        {shown && (
          <SettingContainer
            title={t("settings.advanced.overlay.design.title")}
            description={t("settings.advanced.overlay.design.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={designOptions}
              selectedValue={selectedDesign}
              onSelect={(value) =>
                updateSetting("overlay_design", value as OverlayDesign)
              }
              disabled={isUpdating("overlay_design")}
            />
          </SettingContainer>
        )}

        {showOrbOptions && (
          <SettingContainer
            title={t("settings.advanced.overlay.shape.title")}
            description={t("settings.advanced.overlay.shape.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={shapeOptions}
              selectedValue={selectedShape}
              onSelect={(value) =>
                updateSetting("overlay_shape", value as OverlayShape)
              }
              disabled={isUpdating("overlay_shape")}
            />
          </SettingContainer>
        )}

        {showOrbOptions && (
          <SettingContainer
            title={t("settings.advanced.overlay.speech.title")}
            description={t("settings.advanced.overlay.speech.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={speechOptions}
              selectedValue={selectedSpeech}
              onSelect={(value) =>
                updateSetting("overlay_speech", value as OverlaySpeech)
              }
              disabled={isUpdating("overlay_speech")}
            />
          </SettingContainer>
        )}

        {showOrbOptions && (
          <SettingContainer
            title={t("settings.advanced.overlay.color.title")}
            description={t("settings.advanced.overlay.color.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={colorOptions}
              selectedValue={selectedColor}
              onSelect={(value) =>
                updateSetting("overlay_color", value as OverlayColor)
              }
              disabled={isUpdating("overlay_color")}
            />
          </SettingContainer>
        )}

        {shown && (
          <SettingContainer
            title={t("settings.advanced.overlay.position.title")}
            description={t("settings.advanced.overlay.position.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Dropdown
              options={positionOptions}
              selectedValue={selectedPosition}
              onSelect={(value) =>
                updateSetting("overlay_position", value as OverlayPosition)
              }
              disabled={isUpdating("overlay_position")}
            />
          </SettingContainer>
        )}
      </>
    );
  },
);
